const YAML = require('yaml')

module.exports = {
  parse,
}

function parse(raw, format) {
  switch (format) {
    case 'yaml':
      return YAML.parse(raw)
    case 'json':
      return JSON.parse(raw)
    default:
      try {
        return YAML.parse(raw)
      } catch {
        return JSON.parse(raw)
      }
  }
}
