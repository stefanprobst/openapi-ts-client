const prettier = require('prettier')
const {
  createImports: defaultCreateImports,
  createRequestFunction: defaultCreateRequestFunction,
  createEndpoint: defaultCreateEndpoint,
} = require('./client')
const {
  isRef,
  buildRefMap,
  getTypeNameFromRef,
  createTypeName,
  createTypeIdentifier,
  createOperationName,
} = require('./utils')
const { convertObj } = require('swagger2openapi')

///

module.exports = {
  generate,
}

const shownWarnings = {}

function warn(key) {
  if (!shownWarnings[key]) {
    shownWarnings[key] = true
    console.warn('⚠️', `"${key}" keyword not yet implemented.`)
  }
}

///

async function defaultPreProcess({ openApiDocument }) {
  if (openApiDocument.swagger === '2.0') {
    const { openapi } = await convertObj(openApiDocument, {
      patch: true,
      warnOnly: true,
      targetVersion: '3.0.3',
    })
    return openapi
  }
  return openApiDocument
}

async function defaultValidate({ openApiDocument }) {
  if (
    typeof openApiDocument.openapi !== 'string' ||
    !openApiDocument.openapi.startsWith('3')
  ) {
    throw new Error(`Only OpenAPI v3 documents are supported.`)
  }
}

///

async function generate({
  openApiDocument: initialOpenApiDocument,
  preProcess = defaultPreProcess,
  validate = defaultValidate,
  createImports = defaultCreateImports,
  createRequestFunction = defaultCreateRequestFunction,
  createEndpoint = defaultCreateEndpoint,
  baseUrl,
  prettierConfig = {},
}) {
  const openApiDocument = await preProcess({
    openApiDocument: initialOpenApiDocument,
  })

  await validate({ openApiDocument })

  const statements = []

  statements.push(createInfoHeader({ openApiDocument }))
  // TODO: openApiDocument.servers[] (maybe put in the info header)
  // TODO: openApiDocument.security[]
  // TODO: openApiDocument.components.securitySchemes (maybe also put in info header)

  statements.push(createImports({ openApiDocument }))

  buildRefMap({ openApiDocument })
  statements.push(...createTypesFromSchemas({ openApiDocument }))
  statements.push(...createTypesFromParameters({ openApiDocument }))
  statements.push(...createTypesFromRequestBodies({ openApiDocument }))
  statements.push(...createTypesFromResponses({ openApiDocument }))
  // TODO:: components.headers, components,examples, components. securitySchemes, components.links, components.callbacks

  statements.push(createRequestFunction({ openApiDocument, baseUrl }))
  // TODO: openApiDocument.tags[]
  statements.push(...createEndpoints({ openApiDocument, createEndpoint }))

  // TODO: openApiDocument.externalDocs

  return prettier.format(statements.join('\n\n'), {
    ...prettierConfig,
    parser: 'typescript',
  })
}

///

function createInfoHeader({ openApiDocument }) {
  const {
    title,
    description,
    termsOfService,
    contact,
    license,
    version,
  } = openApiDocument.info

  // TODO: only title and version are required
  // TODO: zip with '\n
  // TODO: display the optional license.url field?
  return createComment(
    [
      title,
      '\n',
      ...(description ? [description, '\n'] : []),
      termsOfService && `Terms of service: ${termsOfService}`,
      contact &&
        `Contact: ${[contact.name, contact.email, contact.url]
          .filter(Boolean)
          .join(', ')}`,
      license && `License: ${license.name}`,
      `Version: ${version}`,
    ].filter(Boolean)
  )
}

function createTypesFromSchemas({ openApiDocument }) {
  const { components } = openApiDocument
  if (!components || !components.schemas) return []

  return Object.entries(components.schemas).map(([name, schema]) => {
    // TODO: consider creating interfaces for object types
    const typeName = createTypeName(name)
    const typeDefinition = createType(schema)
    return createTypeAlias(typeName, typeDefinition)
  })
}

function createTypesFromParameters({ openApiDocument }) {
  const { components } = openApiDocument
  if (!components || !components.parameters) return []

  throw new Error('"components.parameters" not yet implemented.')
}

function createTypesFromRequestBodies({ openApiDocument }) {
  const { components } = openApiDocument
  if (!components || !components.requestBodies) return []

  return Object.entries(components.requestBodies).map(([name, component]) => {
    // FIXME: currently only process the first (not multiple entries with different mediatype)
    const [schema] = getRequestBodySchemas(component)
    // TODO: consider creating interfaces for object types
    const typeName = createTypeName(name, 'RequestBody')
    const typeDefinition = createType(schema)
    return createTypeAlias(typeName, typeDefinition)
  })
}

function createTypesFromResponses({ openApiDocument }) {
  const { components } = openApiDocument
  if (!components || !components.responses) return []

  throw new Error('"components.responses" not yet implemented.')
}

function createEndpoints({ openApiDocument, createEndpoint }) {
  const { paths } = openApiDocument

  const endpoints = []

  Object.entries(paths).forEach(([path, operations]) => {
    if (operations.description || operations.summary) {
      endpoints.push(
        createComment(
          [operations.description, operations.summary].filter(Boolean)
        )
      )
    }

    if (isRef(operations)) {
      throw new Error(`External $ref for path item object not yet implemented.`)
    }

    if (operations.servers) {
      throw new Error(`Custom per-endpoint servers not yet implemented.`)
    }

    // TODO:
    const HTTP_METHODS = [
      'get',
      'delete',
      // 'head',
      // 'options',
      'patch',
      'post',
      'put',
      // 'trace',
    ]
    // TODO: should this be a separate type? i.e. OperationParameters & SharedParameters
    const sharedParameters = operations.parameters || []
    // FIXME: code style
    Object.entries(operations)
      .filter(([method]) => HTTP_METHODS.includes(method))
      .forEach(([method, operation]) => {
        // TODO:
        const {
          // tags,
          summary,
          description,
          // externalDocs,
          operationId,
          parameters = [],
          requestBody,
          responses,
          // callbacks,
          // deprecated,
          // security,
          // servers,
        } = operation

        // default to `${method}${path}` when no operationId provided. this is also the behavior of swagger-client
        const opName = operationId || `${method}${path}`
        const operationName = createOperationName(opName)
        const typeName = createTypeName(opName)
        const namespace = []

        if (description || summary) {
          endpoints.push(createComment([description, summary].filter(Boolean)))
        }

        const headers = {}
        const returnType = 'json' // TODO: actually set return type based on content.mediatype (for refs, we could get it from the refmap)
        const allParameters = [...sharedParameters, ...parameters]
        const parametersByLocation = {}
        allParameters.forEach((parameter) => {
          if (!parametersByLocation[parameter.in]) {
            parametersByLocation[parameter.in] = {
              type: 'object',
              required: [],
              properties: {},
            }
          }
          parametersByLocation[parameter.in].properties[parameter.name] =
            parameter.schema
          // FIXME: "required" behavior???
          if (parameter.required !== false) {
            parametersByLocation[parameter.in].required.push(parameter.name)
          }
        })

        Object.entries(parametersByLocation).forEach(([location, schema]) => {
          const typeName = createTypeIdentifier(
            /** typeName + */ `${location}Parameters`
          )
          const typeDefinition = createType(schema)
          namespace.push(createTypeAlias(typeName, typeDefinition))
        })

        const responseTypeName = createTypeIdentifier(
          /** typeName + */ `Response`
        )
        if (responses) {
          const successResponses = Object.entries(responses || {})
            .filter(([statusCode]) => statusCode.startsWith('2'))
            .map(([statusCode, { description, content }]) => {
              if (!content) return ['void']

              // TODO: should we check for specific media types?
              return Object.entries(content).map(([mediaType, { schema }]) =>
                createType(schema)
              )
            })
            .flat()

          // FIXME: DRY!
          const errorResponses = Object.entries(responses || {})
            .filter(
              ([statusCode]) =>
                statusCode === 'default' ||
                statusCode.startsWith('4') ||
                statusCode.startsWith('5')
            )
            .map(([statusCode, { description, content }]) => {
              if (!content) return ['unknown']

              // TODO: should we check for specific media types?
              return Object.entries(content).map(([mediaType, { schema }]) =>
                createType(schema)
              )
            })
            .flat()

          const successTypeDefinition = createTypeUnion([
            ...(successResponses.length ? successResponses : ['void']),
          ])
          const errorTypeDefinition = createTypeUnion([
            ...(errorResponses.length ? errorResponses : ['unknown']),
          ])
          namespace.push(
            createNamespace(responseTypeName, [
              createTypeAlias('Success', successTypeDefinition),
              createTypeAlias('Error', errorTypeDefinition),
            ])
          )
        }

        if (requestBody) {
          const schemas = getRequestBodySchemas(requestBody)
          // FIXME: doing this with oneOf might make sense
          // const oneOfAllowedMediaTypes = {
          //   oneOf: Object.entries(content).map(([mediaType, schema]) => {

          //   })
          // }
          // TODO: should we check for specific media types?
          const requestBodies = schemas.map(createType)
          const typeName = createTypeIdentifier(/** typeName + */ `RequestBody`)
          const typeDefinition = createTypeUnion(requestBodies)
          namespace.push(createTypeAlias(typeName, typeDefinition))

          headers['Content-Type'] = 'application/json'
        }

        ///
        endpoints.push(createNamespace(typeName, namespace))
        ///

        // FIXME: code style, avoid reduce
        const parameterNamesByLocation = Object.entries(
          parametersByLocation
        ).reduce((acc, [location, parameters]) => {
          acc[location] = Object.keys(parameters)
          return acc
        }, {})

        endpoints.push(
          createEndpoint({
            operationName,
            method,
            pathTemplate: path,
            // baseUrl,
            parameters: parameterNamesByLocation,
            hasRequestBody: Boolean(requestBody),
            headers,
            returnType,
            typeName,
          })
        )
      })
  })

  return endpoints
}

///

function createComment(stringOrLines) {
  const lines = Array.isArray(stringOrLines)
    ? stringOrLines
    : stringOrLines.split('\n')
  // prettier-ignore
  return [
    '/**',
    lines
      .map((s) => ' * ' + s.trim())
      .join('\n'),
    ' */'
  ].join('\n')
}

function createTypeAlias(name, typeDefinition) {
  return `export type ${name} = ${typeDefinition}`
}

function createNamespace(name, children) {
  return `export namespace ${name} {
    ${children.join('\n')}
  }`
}

function createType(schema) {
  if (isRef(schema)) {
    return getTypeNameFromRef(schema)
  }

  // FIXME: this only works in a few cases
  if (schema.allOf) {
    return schema.allOf.map(createType).join(' & ')
  }
  if (schema.anyOf) {
    return schema.anyOf.map(createType).join(' | ')
  }
  if (schema.not) {
    throw new Error(`"not" keyword not yet implemented.`)
  }
  if (schema.oneOf) {
    return schema.oneOf.map(createType).join(' | ')
  }
  if (schema.discriminator) {
    throw new Error(`"discriminator" keyword not yet implemented.`)
  }

  if (schema.deprecated) {
    warn('deprecated')
  }
  if (schema.default) {
    warn('default')
  }

  // TODO: support these valid json schema properties:
  // - title
  // - multipleOf
  // - maximum
  // - exclusiveMaximum
  // - minimum
  // - exclusiveMinimum
  // - maxLength
  // - minLength
  // - pattern (=RegExp)
  // - maxItems
  // - minItems
  // - uniqueItems
  // - maxProperties
  // - minProperties

  switch (schema.type) {
    case 'array':
      return createArrayType(schema)
    case 'object':
      return createObjectType(schema)
    default:
      return createScalarType(schema)
  }
}

function createScalarType(schema) {
  if (schema.enum) {
    return createEnumType(schema)
  }

  switch (schema.type) {
    case 'boolean': {
      const type = 'boolean'
      return schema.nullable ? createNullableType(type) : type
    }
    case 'integer': {
      /**
       * the openapi spec defines "int32" and "int64" as integer formats,
       * but allows free-form values, even though those are undefined by
       * the spec.
       */
      const type = schema.format ? `number /* ${schema.format} */` : 'number'
      return schema.nullable ? createNullableType(type) : type
    }
    case 'number': {
      /**
       * the openapi spec defines "float" and "double" as number formats,
       * but allows free-form values, even though those are undefined by
       * the spec.
       */
      const type = schema.format ? `number /* ${schema.format} */` : 'number'
      return schema.nullable ? createNullableType(type) : type
    }
    case 'string': {
      /**
       * the openapi spec defines "byte", "binary", "date", "date-time" and
       * "password" as string formats, but allows free-form values, even
       * though those are undefined by the spec.
       */
      const type = schema.format ? `string /* ${schema.format} */` : 'string'
      return schema.nullable ? createNullableType(type) : type
    }
    default:
      throw new Error(`Unknown scalar type ${schema.type}.`)
  }
}

function createEnumType(schema) {
  // TODO: can enum values be $refs?
  // TODO: are there enums of arrays, objects?
  switch (schema.type) {
    case 'boolean':
    case 'integer':
    case 'number': {
      const values = schema.nullable ? [...schema.enum, 'null'] : schema.enum
      return createTypeUnion(values)
    }
    case 'string': {
      const wrapped = schema.enum.map((value) => `"${value}"`)
      const values = schema.nullable ? [...wrapped, 'null'] : wrapped
      return createTypeUnion(values)
    }
    default:
      throw new Error(`Unknown enum type ${schema.type}.`)
  }
}

function createArrayType(schema) {
  const type = `Array<${createType(schema.items)}>`
  return schema.nullable ? createNullableType(type) : type
}

function createObjectType(schema) {
  // TODO: is it possible to have both properties and additionalProperties?
  // if yes, we would have to use { [key: string]: unknown } instead of Record<string, unknown>
  // TODO: also, clarify additionalProperties: the spec says:
  // "Consistent with JSON Schema, additionalProperties defaults to true."

  let properties = []

  if (schema.properties) {
    // FIXME: "required" is quite confusing, especially wrt to the default behavior,
    // as it is actually context dependent when used together with `readOnly`/`writeOnly`.
    // we don't currently handle that context-aware behavior (which will change in openapi 3.1 anyway).
    // we default to all properties being optional, as required by spec.
    const requiredProperties = new Set(
      schema.required // || Object.keys(schema.properties)
    )
    properties.push(
      ...Object.entries(schema.properties).map(([name, schema]) =>
        createObjectTypeProperty(name, schema, requiredProperties.has(name))
      )
    )
  }

  if (schema.additionalProperties !== undefined) {
    // use Record for dictionary
    if (properties.length === 0) {
      let type
      if (
        schema.additionalProperties === true ||
        Object.keys(schema.additionalProperties).length === 0
      ) {
        type = 'Record<string, unknown>'
      } else {
        type = `Record<string, ${createType(schema.additionalProperties)}>`
      }
      return schema.nullable ? createNullableType(type) : type
    }

    if (schema.additionalProperties === true) {
      properties.push('[key: string]: unknown')
    } else {
      properties.push(
        `[key: string]: ${createType(schema.additionalProperties)}`
      )
    }
  }

  const type = ['{', properties, '}'].join('\n')
  return schema.nullable ? createNullableType(type) : type
}

function createObjectTypeProperty(name, schema, required = false) {
  if (schema.readOnly) {
    warn('readOnly')
  }
  if (schema.writeOnly) {
    warn('writeOnly')
  }
  if (schema.xml) {
    warn('xml')
  }
  return `"${name}"${required ? '' : '?'}: ${createType(schema)}`
}

function createTypeUnion(types) {
  return types.join(' | ')
}

function createNullableType(type) {
  const types = Array.isArray(type) ? [...type, 'null'] : [type, 'null']
  return createTypeUnion(types)
}

function getRequestBodySchemas(maybeSchema) {
  // TODO: can we assume this is valid, e.g. { $ref: "" } when !content
  if (!maybeSchema.content) return [maybeSchema]
  return Object.values(maybeSchema.content).map(({ schema }) => schema)
}
