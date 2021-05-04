const { capitalize, getServerUrl } = require('./utils')

module.exports = {
  createImports,
  createRequestFunction,
  createEndpoint,
}

function createImports() {
  return [
    '/* eslint-disable @typescript-eslint/no-namespace */',
    '',
    'import { useMutation, useQuery } from "react-query"',
    'import type { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "react-query"',
  ].join('\n')
}

function createRequestFunction({ openApiDocument, baseUrl: customBaseUrl }) {
  const { servers } = openApiDocument
  // if a server is defined in the openapi document, we take the baseUrl
  // from the first one. if no server is defined, we fall back to
  // an environment variable
  // TODO: don't hardcode env variable name
  // TODO: the spec allows the server url to be relative, which would break
  // the url constructor
  let baseUrl = customBaseUrl
    ? `"${customBaseUrl}"`
    : servers && servers.length !== 0
    ? `"${getServerUrl(servers[0])}"`
    : 'process.env.NEXT_PUBLIC_API_BASE_URL'

  return [
    `const defaultBaseUrl = ${baseUrl}`,
    'export { defaultBaseUrl as baseUrl }',
    `export class HttpError extends Error {
      response: Response
      statusCode: number

      constructor(response: Response, message?: string) {
        super((message ?? response.statusText) || 'Unexpected HTTP error.')
        this.name = 'HttpError'
        this.response = response
        this.statusCode = response.status
      }
    }`,
    `function createUrl(
      path: string,
      baseUrl = defaultBaseUrl,
      query: Record<string, unknown> = {}
    ) {
      const url = new URL(path, baseUrl)
      Object.entries(query).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach(v => {
            if (v != null) {
              url.searchParams.append(key, String(v))
            }
          })
        } else if (value != null) {
          url.searchParams.set(key, String(value))
        }
      })
      return url.toString()
    }`,
    `type RequestOptions<T> = {
      hooks?: {
        request?: ((request: Request) => Request)
        response?: ((response: Response) => Promise<T>)
      }
      token?: string
    }
    export async function request<T = unknown>({
      path,
      baseUrl,
      query,
      options,
      hooks = {},
      token,
      returnType = 'json'
    }: {
      path: string
      baseUrl?: string
      query?: Record<string, unknown>
      options?: RequestInit
      hooks?: RequestOptions<T>['hooks']
      token?: RequestOptions<T>['token']
      returnType?: 'json'
    }): Promise<T> {
      const url = createUrl(path, baseUrl, query)
      const req = new Request(url, options)
      const request = typeof hooks.request === 'function' ? hooks.request(req) : req
      if (token !== undefined && token.length > 0) {
        request.headers.set('Authorization', token)
      }
      const response = await fetch(request)
      if (!response.ok) {
        let message
        if (response.headers.get('content-type') === 'application/json') {
          const data = await response.json()
          if (typeof data.message === 'string') {
            message = data.message
          } else if (data.error != null) {
            if (typeof data.error === 'string') {
              message = data.error
            } else if (typeof data.error?.message === 'string') {
              message = data.error.message
            }
          } else if (Array.isArray(data.errors)) {
            const [error] = data.errors
            if (typeof error === 'string') {
              message = error
            } else if (typeof error.message === 'string') {
              message = error.message
            }
          }
        }
        throw new HttpError(response, message)
      }
      if (typeof hooks.response === 'function') return hooks.response(response)
      return response[returnType]()
    }`,
  ].join('\n\n')
}

function createEndpoint({
  operationName,
  method,
  pathTemplate,
  baseUrl, // optionally override global baseUrl
  parameters,
  hasRequestBody,
  headers,
  returnType,
  typeName,
}) {
  const path = parameters.path
    ? pathTemplate.replace(/{(.+?)}/g, '${encodeURIComponent(pathParams.$1)}')
    : pathTemplate

  const params = [
    parameters.path && `pathParams: ${typeName}.PathParameters`,
    parameters.query && `queryParams: ${typeName}.QueryParameters`,
    hasRequestBody && `body: ${typeName}.RequestBody`,
  ].filter(Boolean)

  const untypedParams = [
    parameters.path && `pathParams`,
    parameters.query && `queryParams`,
    hasRequestBody && `body`,
  ].filter(Boolean)

  const mutationFnParams = [
    parameters.path && `${typeName}.PathParameters`,
    parameters.query && `${typeName}.QueryParameters`,
    hasRequestBody && `${typeName}.RequestBody`,
    `RequestOptions<${typeName}.Response.Success>`,
  ].filter(Boolean)

  const isQueryHook = method.toLowerCase() === 'get'
  const hook = isQueryHook ? 'useQuery' : 'useMutation'
  const queryHookParams = [
    ...params,
    `options?: ${'UseQueryOptions'}<${typeName}.Response.Success, ${typeName}.Response.Error>`,
    `requestOptions?: RequestOptions<${typeName}.Response.Success>`,
  ]
  const hooksCacheKey = [
    parameters.path && `pathParams`,
    parameters.query && `queryParams`,
  ].filter(Boolean)

  return [
    `export async function ${operationName}(${
      isQueryHook
        ? params
            .concat(
              `requestOptions?: RequestOptions<${typeName}.Response.Success>`
            )
            .join(', ')
        : `[${untypedParams
            .concat('requestOptions')
            .join(', ')}]: [${params
            .concat(
              `requestOptions?: RequestOptions<${typeName}.Response.Success>`
            )
            .join(', ')}]`
    }): Promise<${typeName}.Response.Success> {
      return request({
        path: \`${path}\`,
        baseUrl: ${JSON.stringify(baseUrl)},
        query: ${parameters.query ? 'queryParams' : 'undefined'},
        options: {
          method: ${JSON.stringify(method)},
          body: ${hasRequestBody ? 'JSON.stringify(body)' : 'undefined'},
          headers: ${JSON.stringify(headers)},
        },
        returnType: ${JSON.stringify(returnType)},
        hooks: requestOptions?.hooks,
        token: requestOptions?.token,
      })
    }`,
    isQueryHook
      ? `export function use${capitalize(operationName)}(${queryHookParams.join(
          ', '
        )}): UseQueryResult<${typeName}.Response.Success, ${typeName}.Response.Error> {
      return ${hook}([${[`"${operationName}"`]
          .concat(hooksCacheKey)
          .join(', ')}], () => ${operationName}(${hooksCacheKey
          .concat('requestOptions')
          .join(', ')}), options)
      }`
      : // we have to make TVariables an array - and thus also make the mutation function accept
        // args as an array, because the react-query typings don't currently allow multiple
        // args for a mutation function
        `export function use${capitalize(
          operationName
        )}(options?: UseMutationOptions<
          ${typeName}.Response.Success,
          ${typeName}.Response.Error,
          [${mutationFnParams.join(', ')}],
          unknown
          >): UseMutationResult<
          ${typeName}.Response.Success,
          ${typeName}.Response.Error,
          [${mutationFnParams.join(', ')}],
          unknown
        > {
        return ${hook}(${operationName}, options)
        }`,
  ].join('\n\n')
}
