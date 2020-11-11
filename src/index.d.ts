declare function generate({
  openApiDocument,
  baseUrl,
  prettierConfig,
}: {
  openApiDocument: any
  baseUrl?: string
  prettierConfig?: any
}): string

export { generate }
