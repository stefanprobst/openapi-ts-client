const camelCase = require('lodash.camelcase')

const createdTypeNames = new Set()
const refMap = new Map()

module.exports = {
  isRef,
  buildRefMap,
  getTypeNameFromRef,
  refMap,
  createTypeName,
  createTypeIdentifier,
  toPascalCase,
  createOperationName,
  capitalize,
  getServerUrl,
}

function isRef(schemaOrRef) {
  return Boolean(schemaOrRef.$ref)
}

function buildRefMap({ openApiDocument }) {
  const { components } = openApiDocument
  if (!components) return

  // TODO: examples, headers, securitySchemes, links, callbacks
  const keys = ['schemas', 'parameters', 'requestBodies', 'responses']
  keys.forEach((key) => {
    Object.keys(components[key] || {}).forEach((refName) => {
      const typeName = createTypeIdentifier(refName)
      refMap.set(`#/components/${key}/${refName}`, typeName)
    })
  })
}

function getTypeNameFromRef(schema) {
  const { $ref: ref } = schema
  if (!refMap.has(ref)) {
    throw new Error(`Unknown $ref ${ref}.`)
  }
  return refMap.get(ref)
}

function createTypeName(string, suffix) {
  const typeName = createTypeIdentifier(string, suffix)
  if (createdTypeNames.has(typeName)) {
    throw new Error(`Duplicate type name ${typeName} (created from ${string}).`)
  }
  createdTypeNames.add(typeName)
  return typeName
}

function createTypeIdentifier(string, suffix = '') {
  return toPascalCase(string + suffix)
}

function toPascalCase(string) {
  if (!string) return string
  const camelCasedString = camelCase(string)
  return capitalize(camelCasedString)
}

function createOperationName(string) {
  return camelCase(string)
}

function capitalize(string) {
  return string && string.charAt(0).toUpperCase() + string.slice(1)
}

function getServerUrl(server) {
  // TODO: support variable substitution as allowed per spec
  return server.url
}
