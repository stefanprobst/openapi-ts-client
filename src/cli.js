#!/usr/bin/env node

const path = require('path')
const { promises: fs, existsSync } = require('fs')
const parseParams = require('mri')
const got = require('got')
const { generate } = require('./index')
const { parse } = require('./parse')

const log = {
  success(...message) {
    console.log('✅', ...message)
  },
  error(...message) {
    console.error('⛔', ...message)
  },
  warn(...message) {
    console.warn('⚠️', ...message)
  },
  info(...message) {
    console.info('ℹ', ...message)
  },
}

main()

async function main() {
  const {
    help,
    file,
    url,
    outputPath,
    preProcess,
    validate,
    imports,
    request,
    endpoint,
  } = getOptions()

  if (help) {
    showHelp()
    return Promise.resolve()
  }

  if (
    (!file || typeof file !== 'string') &&
    (!url || typeof url !== 'string')
  ) {
    log.error('Requires either `file` or `url` argument.\n')
    showHelp()
    return Promise.resolve()
  }

  if (file && url) {
    log.error('Specify only one of `file` or `url` as input source.\n')
    showHelp()
    return Promise.resolve()
  }

  if (!outputPath || typeof outputPath !== 'string') {
    log.error('Requires output argument.\n')
    showHelp()
    return Promise.resolve()
  }

  const [raw, format] = file
    ? await getFileContent(file)
    : await getUrlContent(url)

  let parsed
  try {
    parsed = parse(raw, format)
  } catch (error) {
    log.error('Failed to parse document.', error)
    return Promise.resolve()
  }

  const preProcessFileContent = preProcess && require(preProcess)
  const validateFileContent = validate && require(validate)
  const importsFileContent = imports && require(imports)
  const requestFileContent = request && require(request)
  const endpointFileContent = endpoint && require(endpoint)

  let client
  try {
    client = await generate({
      openApiDocument: parsed,
      preProcess: preProcessFileContent,
      validate: validateFileContent,
      createImports: importsFileContent,
      createRequestFunction: requestFileContent,
      createEndpoint: endpointFileContent,
    })
  } catch (error) {
    log.error('Failed to generate openapi client.', error)
    return Promise.resolve()
  }

  try {
    const absolutePath = path.join(process.cwd(), outputPath)
    const absoluteDir = path.dirname(absolutePath)
    if (!existsSync(absoluteDir)) {
      await fs.mkdir(absoluteDir, { recursive: true })
    }
    await fs.writeFile(absolutePath, client, {
      encoding: 'utf-8',
    })
    log.success(`Successfully created OpenAPI client at ${absolutePath}.`)
  } catch (error) {
    log.error('Failed to write output.', error)
    return Promise.resolve()
  }
}

function getOptions() {
  const args = parseParams(process.argv.slice(2), {
    alias: {
      help: 'h',
      file: 'f',
      url: 'u',
      output: 'o',
    },
  })
  return {
    help: args.help,
    file: args.file,
    url: args.url,
    outputPath: args.output,
    preProcess: args.preprocess,
    validate: args.validate,
    imports: args.imports,
    request: args.request,
    endpoint: args.endpoint,
  }
}

async function getFileContent(file) {
  const absolutePath = path.join(process.cwd(), file)
  const content = await fs.readFile(absolutePath, { encoding: 'utf-8' })
  const format = file.endsWith('.json')
    ? 'json'
    : /\.ya?ml$/.test(file)
    ? 'yaml'
    : undefined
  return [content, format]
}

async function getUrlContent(url) {
  const response = await got(url)
  const content = response.body
  const contentType = response.headers['content-type']
  const format = contentType.startsWith('application/json')
    ? 'json'
    : // there is no official mimetype for yaml - 'application/yaml' or 'text/x-yaml' etc.
    contentType.includes('yaml')
    ? 'yaml'
    : undefined
  return [content, format]
}

function showHelp() {
  log.info(
    [
      'Usage: create-openapi-client (--file [FILE] | --url [URL]) --output [FILE]',
      '',
      'Options:',
      '',
      '-f, --file\tpath to openapi document',
      '-u, --url\turl to openapi document',
      '-o, --output\tpath to output file',
      '--preprocess\tpath to function to preprocess input',
      '--imports\tpath to function which adds imports to client (optional)',
      '--request\tpath to function which defines a shared request function (optional)',
      '--endpoint\tpath to a function which generates a request function for an endpoint',
      '-h, --help\tshow this help message',
      '',
      'Examples:',
      '',
      'create-openapi-client \\\n  -f src/api/openapi.json \\\n  -o src/api/client.ts',
      '',
      'create-openapi-client \\\n  -u https://raw.githubusercontent.com/OAI/OpenAPI-Specification/master/examples/v3.0/petstore.yaml \\\n  -o src/api/petstore.ts',
      '',
      'create-openapi-client \\\n  -f src/api/openapi.yaml \\\n  -o src/api/client.ts \\\n  --preprocess src/api/utils/preprocess.ts \\\n  --imports src/api/utils/imports.ts \\\n  --request src/api/utils/request.ts \\\n  --endpoint src/api/utils/endpoint.ts',
    ].join('\n')
  )
}
