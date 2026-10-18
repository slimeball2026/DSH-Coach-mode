/**
 * 本地工具定义助手 —— **不 import 任何 `@deepseek-ai/*`**。
 *
 * 为什么自己写：profile 里装的 bundle 与 dsh 自己的包**不在同一棵 node_modules 里**
 * （dsh 的包装在 `app.asar` 内），所以 `import '@deepseek-ai/dsh-tools'` 会
 * `ERR_MODULE_NOT_FOUND`，整个插件行加载失败、preset 显示「加载失败」。
 * 这条实测结论对整包生效：`core/` 与适配层都不许出现宿主包的 bare import。
 *
 * 本文件把 `defineTool` 需要的两件事自己做掉：
 *   1. 把"隐式属性表"DSL 编译成**原始 JSON Schema**（registry 要的就是原始 schema）；
 *   2. 产出 `{ name, description, parameters, output, execute }` 的原始工具定义。
 *
 * 参数校验交给 `core/` 里的显式校验（那些报错信息比通用 schema 报错更有用）。
 */

/** 允许出现在 schema 节点上的纯注解键。 */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']

/** 抛出编译错误。 */
function authorError(message) {
  throw new Error(`工具 schema 不合法：${message}`)
}

/** 复制注解字段。 */
function copyAnnotations(source, target) {
  for (const key of ANNOTATION_KEYS) {
    if (Object.hasOwn(source, key)) target[key] = source[key]
  }
}

/** 拒绝声明之外的键。 */
function assertAuthorKeys(source, path, allowed, allowRequired) {
  const permitted = allowRequired ? [...allowed, 'required'] : allowed
  for (const key of Object.keys(source)) {
    if (!permitted.includes(key)) authorError(`${path}.${key} 不是支持的字段（允许：${permitted.join(', ')}）`)
  }
}

/**
 * 编译一个值 schema 节点。
 * @param {object} input 作者写的节点。
 * @param {string} path 报错路径。
 * @param {boolean} allowRequired 该位置是否允许 `required: true`。
 */
function compileValue(input, path, allowRequired) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    authorError(`${path} 必须是对象`)
  }
  if (Object.hasOwn(input, 'required') && input.required !== true) {
    authorError(`${path}.required 只能是 true`)
  }
  const node = {}
  copyAnnotations(input, node)

  if (Object.hasOwn(input, 'oneOf')) {
    assertAuthorKeys(input, path, [...ANNOTATION_KEYS, 'oneOf'], allowRequired)
    if (Object.hasOwn(input, 'type')) authorError(`${path} 不能同时声明 type 与 oneOf`)
    if (!Array.isArray(input.oneOf) || input.oneOf.length < 2) {
      authorError(`${path}.oneOf 至少要有两个分支`)
    }
    node.oneOf = input.oneOf.map((branch, index) => compileValue(branch, `${path}.oneOf[${index}]`, false))
    return node
  }

  const type = Object.hasOwn(input, 'type') ? input.type : undefined
  switch (type) {
    case 'object': {
      assertAuthorKeys(input, path, [...ANNOTATION_KEYS, 'type', 'properties', 'additionalProperties'], allowRequired)
      if (typeof input.additionalProperties !== 'boolean') {
        authorError(`${path}.additionalProperties 必须显式写成 true 或 false`)
      }
      node.type = 'object'
      node.additionalProperties = input.additionalProperties
      if (Object.hasOwn(input, 'properties')) {
        const compiled = compilePropertyMap(input.properties, `${path}.properties`)
        node.properties = compiled.properties
        if (compiled.required !== undefined) node.required = compiled.required
      }
      return node
    }
    case 'array': {
      assertAuthorKeys(input, path, [...ANNOTATION_KEYS, 'type', 'items'], allowRequired)
      node.type = 'array'
      if (Object.hasOwn(input, 'items')) {
        node.items = compileValue(input.items, `${path}.items`, false)
      }
      return node
    }
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null': {
      assertAuthorKeys(input, path, [...ANNOTATION_KEYS, 'type', 'enum', 'const'], allowRequired)
      node.type = type
      if (Object.hasOwn(input, 'enum')) {
        if (!Array.isArray(input.enum) || input.enum.length === 0) {
          authorError(`${path}.enum 必须是非空数组`)
        }
        node.enum = [...input.enum]
      }
      if (Object.hasOwn(input, 'const')) node.const = input.const
      return node
    }
    default:
      authorError(`${path}.type 必须是 string/number/integer/boolean/null/array/object，或者用 oneOf`)
  }
  return node
}

/**
 * 编译一张属性表：把每个属性上的 `required: true` 提升成父级的 `required` 数组。
 * @returns {{ properties: object, required?: string[] }}
 */
function compilePropertyMap(input, path) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    authorError(`${path} 必须是"属性名 → schema"的对象`)
  }
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && typeof value === 'object' && value.required === true) required.push(key)
    properties[key] = compileValue(value, `${path}.${key}`, true)
  }
  return required.length === 0 ? { properties } : { properties, required }
}

/**
 * 参数表 → 原始 JSON Schema（object 根）。
 * @param {object} spec 形如 `{ 参数名: { type, required?: true, description? } }`。
 */
export function compileParameters(spec) {
  const compiled = compilePropertyMap(spec, 'parameters')
  return {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required }),
  }
}

/**
 * 输出 schema → 原始 JSON Schema。
 * @param {object} spec 值 schema 节点。
 */
export function compileValueSchema(spec) {
  return compileValue(spec, 'schema', false)
}

/**
 * 定义一个工具（registry 直接接受的原始定义）。
 * @param {object} options `{ name, description, parameters, output, execute }`。
 * @returns {object} `ToolDefinition`。
 */
export function defineTool(options) {
  const parameters = compileParameters(options.parameters ?? {})
  const schema = compileValueSchema(options.output.schema)
  const tool = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema,
      render: (args, value) => options.output.render(args, value),
    },
    async execute(args, exec) {
      return options.execute(args ?? {}, exec)
    },
  }
  if (typeof options.output.presentationMeta === 'function') {
    tool.output.presentationMeta = (args, value) => options.output.presentationMeta(args, value)
  }
  return tool
}
