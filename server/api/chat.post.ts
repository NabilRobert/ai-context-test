import { runAgentTurn } from '../../src/agent'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { history, userInput } = body

  if (!userInput) {
    throw createError({
      statusCode: 400,
      statusMessage: 'User input is required'
    })
  }

  try {
    const result = await runAgentTurn(history || [], userInput)
    return result
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Internal Server Error'
    })
  }
})
