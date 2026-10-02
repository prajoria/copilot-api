const UNSAFE_LOG_IDENTIFIER = /[^\w.:/+-]/g
const MAX_LOG_IDENTIFIER_LENGTH = 80

export const sanitizeLogIdentifier = (value: string): string =>
  value
    .replaceAll(UNSAFE_LOG_IDENTIFIER, "_")
    .slice(0, MAX_LOG_IDENTIFIER_LENGTH)

export const upstreamErrorMetadata = (
  response: Response,
  category: string,
): {
  category: string
  status: number
  requestId?: string
} => {
  const requestId =
    response.headers.get("x-github-request-id")
    ?? response.headers.get("x-request-id")

  return {
    category,
    status: response.status,
    ...(requestId ? { requestId: sanitizeLogIdentifier(requestId) } : {}),
  }
}
