/* eslint-disable jest/expect-expect */
const express = require('express')
const supertest = require('supertest')
const nullLogger = require('null-logger')
const { Client } = require('memjs')
const { promisify } = require('util')
const createMiddleware = require('..')

nullLogger.time = nullLogger.timeEnd = () => null

const client = Client.create()
// const get = promisify(client.get.bind(client))
const set = promisify(client.set.bind(client))
const del = promisify(client.delete.bind(client))

afterEach(async () => {
  await client.flush()
})

afterAll(async () => {
  await client.close()
})

describe('integration tests', () => {
  it('respects the cache', async () => {
    const headers = { 'content-type': 'text/plain' }
    const cacheOptions = { expires: 1000 }

    await set('/test', 'this is cached', cacheOptions)
    await set('/test??headers', JSON.stringify(headers), cacheOptions)

    const app = express()
      .use(createMiddleware({ client, logger: nullLogger }))
      .get('/test', (req, res) => {
        res.set(headers).send('this is fresh')
      })

    await supertest(app)
      .get('/test')
      .expect('this is cached')

    await del('/test')

    await supertest(app)
      .get('/test')
      .expect('this is fresh')
  })
})
