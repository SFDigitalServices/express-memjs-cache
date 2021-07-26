/* eslint-disable jest/expect-expect */
const express = require('express')
const supertest = require('supertest')
const nullLogger = require('null-logger')
const { Client } = require('memjs')
const createMiddleware = require('..')

nullLogger.time = nullLogger.timeEnd = () => null

jest.mock('memjs')

const defaultCacheOptions = {
  expires: createMiddleware.DEFAULT_EXPIRES
}

class InMemoryClient {
  constructor () {
    this.cache = new Map()
    this.get = jest.fn((key, cb) => cb(null, this.cache.get(key)))
    this.set = jest.fn((key, value, options, cb) => {
      this.cache.set(key, value)
      cb()
    })
  }
}

Client.create.mockImplementation(() => new InMemoryClient())

describe('cache client', () => {
  it('creates a memjs Client with the default options', () => {
    createMiddleware()
    expect(Client.create).toBeCalled()
  })

  it('passes .clientOptions to the memjs.Client constructor', () => {
    const clientOptions = { foo: 'bar' }
    createMiddleware({ clientOptions, logger: nullLogger })
    expect(Client.create).toBeCalledWith(null, clientOptions)
  })

  it('uses the provided .client', () => {
    const client = new InMemoryClient()
    const app = express()
      .use(createMiddleware({ client, logger: nullLogger }))
      .get('/wut', (req, res) => {
        res.send('ya')
      })
    return supertest(app)
      .get('/wut')
      .expect('x-cache-status', 'MISS')
      .then(() => {
        expect(client.get).toBeCalledTimes(1)
        expect(client.get).toBeCalledWith('/wut', expect.any(Function))
        expect(client.set).toBeCalledTimes(2)
        expect(client.set).toBeCalledWith('/wut', 'ya', defaultCacheOptions, expect.any(Function))
      })
  })
})

describe('logging', () => {
  it('uses the provided .logger', () => {
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }

    const app = express().use(createMiddleware({ logger }))
    return supertest(app)
      .post('/secret')
      .then(() => {
        expect(logger.info).toBeCalled()
      })
  })
})

describe('cache keys', () => {
  it('respects the x-cache-key response header', () => {
    const client = new InMemoryClient()
    const app = express()
      .use((req, res, next) => {
        res.set('x-cache-key', 'publicCacheKey')
        next()
      })
      .use(createMiddleware({
        client,
        logger: nullLogger
      }))
      .get('/', (req, res) => res.send('hi'))
    return supertest(app)
      .get('/')
      .expect('hi')
      .expect('x-cache-status', 'MISS')
      .then(() => {
        expect(client.get).toBeCalledWith('publicCacheKey', expect.any(Function))
        expect(client.set).toBeCalledWith('publicCacheKey', 'hi', defaultCacheOptions, expect.any(Function))
      })
  })

  it('defaults to request.originalUrl', async () => {
    const client = new InMemoryClient()
    const app = express()
      .use(createMiddleware({
        client,
        logger: nullLogger
      }))
      .get('/', (req, res) => {
        res.set('content-type', 'text/plain+lol-wut')
        res.send('hi')
      })

    const test = supertest(app)
    await test.get('/?foo=bar')
      .expect('hi')
      .expect('x-cache-status', 'MISS')
      .expect('content-type', /lol-wut/)
      .then(() => {
        expect(client.get).toBeCalledWith('/?foo=bar', expect.any(Function))
        expect(client.set).toBeCalledWith('/?foo=bar', 'hi', defaultCacheOptions, expect.any(Function))
      })

    client.get.mockClear()
    client.set.mockClear()

    await test.get('/?foo=bar')
      .expect('hi')
      .expect('x-cache-status', 'HIT')
      .expect('content-type', /lol-wut/)
      .then(() => {
        expect(client.get).toBeCalledWith('/?foo=bar', expect.any(Function))
        expect(client.set).not.toBeCalled()
      })
  })
})

describe('cache options', () => {
  it('calls getCacheOptions() with (req, res, { key })', () => {
    let request, response
    const getCacheOptions = jest.fn()
    const app = express()
      .use(createMiddleware({
        logger: nullLogger,
        getCacheOptions
      }))
      .get('/test', (req, res) => {
        request = req
        response = res
        res.send('hi')
      })
    return supertest(app)
      .get('/test')
      .then(() => {
        expect(getCacheOptions).toBeCalledWith(
          request,
          response,
          { key: '/test' }
        )
      })
  })

  it('calls getCacheKey() with (req, res)', () => {
    let request, response
    const getCacheKey = jest.fn(() => 'wut')
    const app = express()
      .use(createMiddleware({
        logger: nullLogger,
        getCacheKey
      }))
      .get('/test', (req, res) => {
        request = req
        response = res
        res.send('hi')
      })
    return supertest(app)
      .get('/test')
      .expect('x-cache-key', 'wut')
      .then(() => {
        expect(getCacheKey).toBeCalledWith(request, response)
      })
  })
})

describe('error handling', () => {
  describe('non-GET requests', () => {
    const app = express()
      .use(createMiddleware({ logger: nullLogger }))

    it('bypasses POST requests', () => {
      return supertest(app)
        .post('/foo')
        .expect('x-cache-status', 'BYPASS')
    })

    it('bypasses PUT requests', () => {
      return supertest(app)
        .put('/foo')
        .expect('x-cache-status', 'BYPASS')
    })

    it('bypasses DELETE requests', () => {
      return supertest(app)
        .delete('/foo')
        .expect('x-cache-status', 'BYPASS')
    })

    it('bypasses OPTIONS requests', () => {
      return supertest(app)
        .options('/foo')
        .expect('x-cache-status', 'BYPASS')
    })
  })

  it('respects isError(req, res)', async () => {
    const isError = jest.fn((req, res) => res.locals.error)
    const app = express()
      .use(createMiddleware({
        logger: nullLogger,
        isError
      }))
      .get('/good', (req, res) => res.send('hi'))
      .get('/bad', (req, res) => {
        res.locals.error = true
        res.send('bye')
      })

    await supertest(app)
      .get('/good')
      .expect('hi')
      .expect('x-cache-status', 'MISS')

    // this should hit the second time
    await supertest(app)
      .get('/good')
      .expect('hi')
      .expect('x-cache-status', 'HIT')

    await supertest(app)
      .get('/bad')
      .expect('bye')
      .expect('x-cache-status', 'MISS')

    // this should always miss
    for (let i = 0; i < 10; i++) {
      await supertest(app)
        .get('/bad')
        .expect('bye')
        .expect('x-cache-status', 'MISS')
    }
  })
})
