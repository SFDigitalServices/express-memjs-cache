const { Client } = require('memjs')
const { promisify } = require('util')
const parseCacheControl = require('parse-cache-control')

const CACHE_CONTROL = 'Cache-control'
const NO_CACHE = 'max-age=0'
const X_CACHE_KEY = 'x-cache-key'
const X_CACHE_STATUS = 'x-cache-status'
const DEFAULT_EXPIRES = 60 * 60 * 24 * 30 // 30 days

module.exports = (handlerOrOpts, opts) => {
  const handler = typeof handlerOrOpts === 'function' ? handlerOrOpts : null
  const options = (handler ? opts : handlerOrOpts) || {}
  const {
    loggerOptions,
    logger = defaultLogger(loggerOptions),
    clientOptions = { logger },
    client = defaultClient(clientOptions),
    isError = defaultIsError,
    getCacheKey = defaultGetCacheKey,
    getCacheExpires = defaultGetCacheExpires,
    getCacheOptions = defaultGetCacheOptions
  } = options

  const get = promisify(client.get.bind(client))
  const set = promisify(client.set.bind(client))
  const queue = []

  return async function cacheMiddleware (req, res, next) {
    if (req.method !== 'GET') {
      logger.info('no caching for %s method', req.method)
      res.set(X_CACHE_STATUS, 'BYPASS')
      return next()
    }

    const key = getCacheKey(req, res)
    if (!key) {
      logger.info('no cache key found; skipping cache', req.originalUrl)
      res.set(X_CACHE_STATUS, 'BYPASS')
      return next()
    }

    const headersKey = `${key}??headers`

    if (queue.length) {
      logger.time('dequeue')
      await Promise.all(queue).then(() => {
        while (queue.length) queue.shift()
      })
      logger.timeEnd('dequeue')
    } else {
      logger.debug('no tasks queued')
    }

    logger.info(`get "${key}"`)
    res.set(X_CACHE_KEY, key)

    logger.time('get')
    const cached = await get(key).catch(error => {
      logger.error(`get "${key}" error:`, error)
    })
    logger.timeEnd('get')

    if (cached) {
      logger.info('HIT', key)
      res.set(X_CACHE_STATUS, 'HIT')

      const rawHeaders = await get(headersKey).catch(error => {
        logger.error(`get "${headersKey}" error:`, error)
      })
      if (rawHeaders) {
        const headers = JSON.parse(rawHeaders.toString('utf8'))
        delete headers[X_CACHE_STATUS]
        delete headers[CACHE_CONTROL]
        res.set(headers)
      }

      // FIXME: determine timeout from flags?
      res.set(CACHE_CONTROL, NO_CACHE)
      res.send(cached)
    } else {
      logger.info('MISS', key)
      res.set(X_CACHE_STATUS, 'MISS')

      const unhook = hook(res, 'send', (send, [body]) => {
        if (body && !isError(req, res)) {
          const cacheOptions = getCacheOptions(req, res, { key })
          if (cacheOptions.expires) {
            // tell upstream proxies and clients not to cache this
            res.set(CACHE_CONTROL, NO_CACHE)
          }

          logger.info(`caching "${key}" ...`, body.length, cacheOptions)

          queue.push(
            set(key, body, cacheOptions)
              .then(() => logger.info(`SET "${key}"`))
              .catch(error => logger.error(`SET "${key}" ERROR:`, error))
          )

          queue.push(
            set(headersKey, JSON.stringify(res.getHeaders()), cacheOptions)
              .then(() => logger.info(`SET "${headersKey}"`))
              .catch(error => logger.error(`SET "${headersKey}.headers" ERROR:`, error))
          )

          unhook()
          send(body)
        } else {
          send(body)
        }
      })
      next()
    }
  }

  function defaultGetCacheOptions (...args) {
    return {
      expires: getCacheExpires(...args) || DEFAULT_EXPIRES
    }
  }

  function defaultGetCacheExpires (req, res) {
    // support locals.cacheMaxAge
    const { cacheMaxAge = options.cacheMaxAge } = res.locals
    if (!isNaN(cacheMaxAge)) {
      return cacheMaxAge
    } else {
      // support Cache-control: max-age=XXX
      const header = res.get(CACHE_CONTROL)
      if (header) {
        const parsed = parseCacheControl(header)
        const maxAge = parsed['max-age']
        if (!isNaN(maxAge)) {
          return maxAge
        }
      }
    }
    return DEFAULT_EXPIRES
  }
}

Object.assign(module.exports, {
  CACHE_CONTROL,
  NO_CACHE,
  X_CACHE_KEY,
  X_CACHE_STATUS,
  DEFAULT_EXPIRES
})

function defaultClient (options) {
  return Client.create(null, options)
}

function defaultLogger () {
  return console
}

function defaultGetCacheKey (req, res) {
  return (
    res.get(X_CACHE_KEY) ||
    req.originalUrl // this includes the query string
  )
}

function defaultIsError (req, res) {
  return res.statusCode > 400
}

function hook (obj, method, fn) {
  const original = obj[method]
  obj[method] = function hooked (...args) {
    return fn.call(this, original.bind(this), args)
  }
  return function unhook () {
    obj[method] = original
  }
}
