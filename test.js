/* eslint-disable jest/expect-expect */
const express = require('express')
const supertest = require('supertest')
const memjs = require('memjs')
const createMiddleware = require('.')

jest.mock('memjs')

const nullLogger = {
  info: noop,
  debug: noop,
  log: noop,
  warn: noop,
  error: noop,
  time: noop,
  timeEnd: noop
}

describe('cache client', () => {
  it('creates a memjs.Client with the default options', () => {
    memjs.Client.mockClear()
    createMiddleware()
    expect(memjs.Client).toBeCalled()
  })

  it('passes .clientOptions to the memjs.Client constructor', () => {
    const clientOptions = { foo: 'bar' }
    createMiddleware({ clientOptions, logger: nullLogger })
    expect(memjs.Client).toBeCalledWith(clientOptions)
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
        expect(client.set).toBeCalledWith('/wut', 'ya', {}, expect.any(Function))
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
        expect(client.set).toBeCalledWith('publicCacheKey', 'hi', {}, expect.any(Function))
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
        expect(client.set).toBeCalledWith('/?foo=bar', 'hi', {}, expect.any(Function))
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

describe('error handling', () => {
  const app = express()
    .use(createMiddleware({ logger: nullLogger }))

  describe('non-GET requests', () => {
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
})

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

function noop () {
}
