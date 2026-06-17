const crypto = require('crypto')
const redisClient = require('./redis')

const SINGLE_LOGIN_ENABLED = process.env.SESSION_SINGLE_LOGIN_ENABLED !== 'false'
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

const parseTtlSeconds = (value) => {
  if (!value) return DEFAULT_SESSION_TTL_SECONDS

  if (/^\d+$/.test(String(value))) {
    return Math.max(60, Number(value))
  }

  const match = String(value).trim().match(/^(\d+)\s*([smhd])$/i)
  if (!match) return DEFAULT_SESSION_TTL_SECONDS

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()

  const unitMap = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60
  }

  return Math.max(60, amount * unitMap[unit])
}

const SESSION_TTL_SECONDS = parseTtlSeconds(
  process.env.SESSION_TTL_SECONDS || process.env.JWT_EXPIRES_IN
)

const getUserSessionKey = (userId) => `auth:current_session:${userId}`

const createSessionId = () => {
  if (crypto.randomUUID) return crypto.randomUUID()
  return crypto.randomBytes(32).toString('hex')
}

const createLoginSession = async (userId) => {
  const sessionId = createSessionId()

  if (SINGLE_LOGIN_ENABLED) {
    await redisClient.set(getUserSessionKey(userId), sessionId, {
      EX: SESSION_TTL_SECONDS
    })
  }

  return sessionId
}

const assertSessionIsCurrent = async (userId, sessionId) => {
  if (!SINGLE_LOGIN_ENABLED) return

  if (!sessionId) {
    const error = new Error('登录会话无效，请重新登录')
    error.code = 'SESSION_INVALID'
    throw error
  }

  const currentSessionId = await redisClient.get(getUserSessionKey(userId))

  if (!currentSessionId) {
    const error = new Error('登录会话已过期，请重新登录')
    error.code = 'SESSION_EXPIRED'
    throw error
  }

  if (currentSessionId !== sessionId) {
    const error = new Error('账号已在其他设备登录，本次会话已失效')
    error.code = 'SESSION_REPLACED'
    throw error
  }
}

const destroyLoginSession = async (userId, sessionId) => {
  if (!SINGLE_LOGIN_ENABLED) return

  const key = getUserSessionKey(userId)
  const currentSessionId = await redisClient.get(key)

  if (!sessionId || currentSessionId === sessionId) {
    await redisClient.del(key)
  }
}

const destroyAllLoginSessions = async (userId) => {
  if (!SINGLE_LOGIN_ENABLED) return
  await redisClient.del(getUserSessionKey(userId))
}

module.exports = {
  createLoginSession,
  assertSessionIsCurrent,
  destroyLoginSession,
  destroyAllLoginSessions
}
