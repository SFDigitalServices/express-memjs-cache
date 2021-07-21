const { Client } = require('memjs')
const parseCacheControl = require('parse-cache-control')

const CACHE_CONTROL = 'Cache-control'
const NO_CACHE = 'max-age=0'
const X_CACHE_KEY = 'x-cache-key'
const X_CACHE_STATUS = 'x-cache-status'

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
    getCacheOptions = defaultGetCacheOptions
  } = options

  return async function cacheMiddleware (req, res, next) {
    if (req.method !== 'GET') {
      logger.info('no caching for %s method', req.method)
      res.set(X_CACHE_STATUS, 'BYPASS')
      return next()
    }

    const key = getCacheKey(req, res)
    if (key === undefined) {
      logger.info('no cache key found; skipping cache', req.originalUrl)
      res.set(X_CACHE_STATUS, 'BYPASS')
      return next()
    }

    logger.info(`get "${key}"`)
    res.set(X_CACHE_KEY, key)

    const start = Date.now()
    const cached = await new Promise((resolve, reject) => {
      client.get(key, (error, value) => {
        error ? reject(error) : resolve(value)
      })
    })
      .catch(error => {
        logger.error(`get "${key}" error:`, error)
      })

    logger.info(`time "${key}": %sms`, Date.now() - start)

    if (cached) {
      logger.info('HIT', key, typeof value)
      res.set(X_CACHE_STATUS, 'HIT')
      // FIXME: determine timeout from flags?
      res.set(CACHE_CONTROL, NO_CACHE)
      res.send(cached)
    } else {
      logger.info('MISS', key)
      res.set(X_CACHE_STATUS, 'MISS')
      const unhook = hook(res, 'send', (send, [body]) => {
        if (body && !isError(res)) {
          const cacheOptions = getCacheOptions(res)
          if (cacheOptions.expires) {
            // tell upstream proxies and clients not to cache this
            res.set(CACHE_CONTROL, NO_CACHE)
          }
          logger.info(`caching "${key}" ...`, body.length, cacheOptions)
          client.set(key, body, cacheOptions, error => {
            if (error) {
              logger.error(`... cache "${key}" ERROR:`, error)
            } else {
              logger.info(`cached "${key}"`)
            }
            unhook()
            send(body)
          })
        } else {
          send(body)
        }
      })
      next()
    }
  }

  function defaultGetCacheOptions (res) {
    // support locals.cacheMaxAge
    const { cacheMaxAge = options.cacheMaxAge } = res.locals
    if (!isNaN(cacheMaxAge)) {
      return { expires: cacheMaxAge }
    }

    // support Cache-control: max-age=XXX
    const header = res.get(CACHE_CONTROL)
    if (header) {
      const parsed = parseCacheControl(header)
      const maxAge = parsed['max-age']
      return isNaN(maxAge)
        ? {}
        : { expires: maxAge }
    }
    return {}
  }
}

Object.assign(module.exports, {
  CACHE_CONTROL,
  NO_CACHE,
  X_CACHE_KEY,
  X_CACHE_STATUS
})

function defaultClient (options) {
  return new Client(options)
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

function defaultIsError (res) {
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
