import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

import { upstreamErrorMetadata } from "./logging"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export async function forwardError(c: Context, error: unknown) {
  if (error instanceof HTTPError) {
    const errorText = await error.response.text()
    consola.error(
      "Upstream HTTP error",
      upstreamErrorMetadata(error.response, "upstream_http_error"),
    )
    return c.json(
      {
        error: {
          message: errorText,
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
    )
  }

  consola.error("Internal proxy error", { category: "internal_proxy_error" })
  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}
