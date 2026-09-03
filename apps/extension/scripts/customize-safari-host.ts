import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

interface Range {
  readonly open: number
  readonly close: number
}

interface TargetSpec {
  readonly name: string
  readonly bundleIdentifier: string
  readonly entitlementPath: string
  readonly deploymentKey: "IPHONEOS_DEPLOYMENT_TARGET" | "MACOSX_DEPLOYMENT_TARGET"
  readonly deploymentValue: "15.0" | "12.0"
  readonly privacyKind: "app" | "extension"
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")
const appleRoot = path.join(extensionRoot, "apple")

export const safariTargets: ReadonlyArray<TargetSpec> = [
  {
    name: "Parle (iOS)",
    bundleIdentifier: "com.ziahamza.parle",
    entitlementPath: '"iOS (App)/Parle.entitlements"',
    deploymentKey: "IPHONEOS_DEPLOYMENT_TARGET",
    deploymentValue: "15.0",
    privacyKind: "app"
  },
  {
    name: "Parle Extension (iOS)",
    bundleIdentifier: "com.ziahamza.parle.Extension",
    entitlementPath: '"iOS (Extension)/Parle.entitlements"',
    deploymentKey: "IPHONEOS_DEPLOYMENT_TARGET",
    deploymentValue: "15.0",
    privacyKind: "extension"
  },
  {
    name: "Parle (macOS)",
    bundleIdentifier: "com.ziahamza.parle",
    entitlementPath: '"macOS (App)/Parle.entitlements"',
    deploymentKey: "MACOSX_DEPLOYMENT_TARGET",
    deploymentValue: "12.0",
    privacyKind: "app"
  },
  {
    name: "Parle Extension (macOS)",
    bundleIdentifier: "com.ziahamza.parle.Extension",
    entitlementPath: '"macOS (Extension)/Parle.entitlements"',
    deploymentKey: "MACOSX_DEPLOYMENT_TARGET",
    deploymentValue: "12.0",
    privacyKind: "extension"
  }
]

const stableID = (label: string): string =>
  createHash("sha256").update(`parle-safari-host:${label}`).digest("hex").slice(0, 24).toUpperCase()

const privacyReferences = {
  app: stableID("privacy-reference-app"),
  extension: stableID("privacy-reference-extension")
} as const

const privacyBuildFiles = new Map(
  safariTargets.map((target) => [target.name, stableID(`privacy-build-file:${target.name}`)])
)

const fail = (message: string): never => {
  throw new Error(`Safari host customization failed: ${message}`)
}

const expect: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) fail(message)
}

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const matchingDelimiter = (
  source: string,
  open: number,
  opening: "{" | "(",
  closing: "}" | ")"
): number => {
  expect(source[open] === opening, `expected ${opening} at byte ${open}`)
  let depth = 0
  let quoted = false
  let escapedCharacter = false
  let blockComment = false

  for (let at = open; at < source.length; at += 1) {
    const character = source[at]
    const next = source[at + 1]
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false
        at += 1
      }
      continue
    }
    if (quoted) {
      if (escapedCharacter) {
        escapedCharacter = false
      } else if (character === "\\") {
        escapedCharacter = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }
    if (character === "/" && next === "*") {
      blockComment = true
      at += 1
    } else if (character === '"') {
      quoted = true
    } else if (character === opening) {
      depth += 1
    } else if (character === closing) {
      depth -= 1
      if (depth === 0) return at
    }
  }
  return fail(`unterminated ${opening} beginning at byte ${open}`)
}

const objectRange = (source: string, identifier: string): Range => {
  const definition = new RegExp(
    `^[\\t ]*${escaped(identifier)}(?: /\\*[^\\n]*\\*/)? = \\{`,
    "gm"
  )
  const matches = [...source.matchAll(definition)].filter((match) => {
    expect(match.index !== undefined, `object ${identifier} has no source position`)
    const open = source.indexOf("{", match.index)
    const close = matchingDelimiter(source, open, "{", "}")
    return /\bisa = [A-Za-z][A-Za-z0-9]*;/.test(source.slice(open + 1, close))
  })
  expect(matches.length === 1, `expected one PBX object definition for ${identifier}, found ${matches.length}`)
  const match = matches[0]
  expect(match?.index !== undefined, `object ${identifier} has no source position`)
  const open = source.indexOf("{", match.index)
  return { open, close: matchingDelimiter(source, open, "{", "}") }
}

const objectText = (source: string, identifier: string): string => {
  const range = objectRange(source, identifier)
  return source.slice(range.open + 1, range.close)
}

const objectIdentifier = (source: string, comment: string, isa: string): string => {
  const definition = new RegExp(
    `^[\\t ]*([A-F0-9]{24}) /\\* ${escaped(comment)} \\*/ = \\{`,
    "gm"
  )
  const matches = [...source.matchAll(definition)].filter((match) => {
    const identifier = match[1]
    return identifier !== undefined && objectText(source, identifier).includes(`isa = ${isa};`)
  })
  expect(matches.length === 1, `expected one ${isa} named ${comment}, found ${matches.length}`)
  const identifier = matches[0]?.[1]
  expect(identifier !== undefined, `missing identifier for ${comment}`)
  return identifier
}

const assignmentRange = (
  source: string,
  object: Range,
  key: string,
  opening: "{" | "(",
  closing: "}" | ")"
): Range => {
  const body = source.slice(object.open + 1, object.close)
  const assignment = new RegExp(`\\b${escaped(key)}\\s*=\\s*\\${opening}`, "g")
  const matches = [...body.matchAll(assignment)]
  expect(matches.length === 1, `expected one ${key} assignment, found ${matches.length}`)
  const match = matches[0]
  expect(match?.index !== undefined, `${key} assignment has no source position`)
  const open = object.open + 1 + match.index + match[0].lastIndexOf(opening)
  const close = matchingDelimiter(source, open, opening, closing)
  expect(close < object.close, `${key} extends beyond its object`)
  return { open, close }
}

const configurationIdentifiers = (
  source: string,
  targetName: string
): Readonly<Record<"Debug" | "Release", string>> => {
  const targetID = objectIdentifier(source, targetName, "PBXNativeTarget")
  const target = objectText(source, targetID)
  const listMatches = [...target.matchAll(/\bbuildConfigurationList = ([A-F0-9]{24})\b/g)]
  expect(listMatches.length === 1, `${targetName} has ${listMatches.length} configuration lists`)
  const listID = listMatches[0]?.[1]
  expect(listID !== undefined, `${targetName} configuration list has no identifier`)
  const listRange = objectRange(source, listID)
  const configurations = assignmentRange(source, listRange, "buildConfigurations", "(", ")")
  const entries = [...source.slice(configurations.open + 1, configurations.close).matchAll(
    /([A-F0-9]{24})(?: \/\*[^\n]*\*\/)?/g
  )]
  expect(entries.length === 2, `${targetName} must have exactly Debug and Release configurations`)
  const result = new Map(entries.map((entry) => {
    const identifier = entry[1]
    expect(identifier !== undefined, `${targetName} has a configuration without an identifier`)
    const names = [...objectText(source, identifier).matchAll(/\bname = (Debug|Release);/g)]
    expect(names.length === 1, `${targetName} configuration ${identifier} has no unique name`)
    const name = names[0]?.[1]
    expect(name === "Debug" || name === "Release", `${targetName} configuration ${identifier} has bad name`)
    return [name, identifier] as const
  }))
  const debug = result.get("Debug")
  const release = result.get("Release")
  expect(debug !== undefined && release !== undefined && result.size === 2,
    `${targetName} does not have one Debug and one Release configuration`)
  return { Debug: debug, Release: release }
}

const buildSettingsRange = (source: string, configurationID: string): Range =>
  assignmentRange(source, objectRange(source, configurationID), "buildSettings", "{", "}")

const buildSetting = (source: string, configurationID: string, key: string): string | undefined => {
  const settings = buildSettingsRange(source, configurationID)
  const body = source.slice(settings.open + 1, settings.close)
  const pattern = new RegExp(
    `^[\\t ]*${escaped(key)}\\s*=\\s*([^;\\n]+);[\\t ]*$`,
    "gm"
  )
  const matches = [...body.matchAll(pattern)]
  expect(matches.length <= 1, `${configurationID} has ${matches.length} ${key} settings`)
  return matches[0]?.[1]?.trim()
}

const setBuildSetting = (
  source: string,
  configurationID: string,
  key: string,
  value: string
): string => {
  const settings = buildSettingsRange(source, configurationID)
  const body = source.slice(settings.open + 1, settings.close)
  const pattern = new RegExp(
    `^([\\t ]*)${escaped(key)}\\s*=\\s*([^;\\n]+);[\\t ]*$`,
    "gm"
  )
  const matches = [...body.matchAll(pattern)]
  expect(matches.length <= 1, `${configurationID} has ${matches.length} ${key} settings`)
  const held = matches[0]
  if (held !== undefined) {
    expect(held.index !== undefined, `${configurationID} ${key} has no source position`)
    const start = settings.open + 1 + held.index
    const replacement = `${held[1] ?? ""}${key} = ${value};`
    return source.slice(0, start) + replacement + source.slice(start + held[0].length)
  }

  const closingLine = source.lastIndexOf("\n", settings.close) + 1
  const closingIndent = source.slice(closingLine, settings.close)
  expect(/^[\t ]*$/.test(closingIndent), `${configurationID} buildSettings closing brace moved inline`)
  const addition = `${closingIndent}\t${key} = ${value};\n`
  return source.slice(0, closingLine) + addition + source.slice(closingLine)
}

const targetResourcePhase = (source: string, targetName: string): string => {
  const targetID = objectIdentifier(source, targetName, "PBXNativeTarget")
  const targetRange = objectRange(source, targetID)
  const phases = assignmentRange(source, targetRange, "buildPhases", "(", ")")
  const matches = [...source.slice(phases.open + 1, phases.close).matchAll(
    /([A-F0-9]{24}) \/\* Resources \*\//g
  )]
  expect(matches.length === 1, `${targetName} has ${matches.length} Resources phases`)
  const identifier = matches[0]?.[1]
  expect(identifier !== undefined, `${targetName} Resources phase has no identifier`)
  expect(objectText(source, identifier).includes("isa = PBXResourcesBuildPhase;"),
    `${targetName} Resources phase is not a PBXResourcesBuildPhase`)
  return identifier
}

const countIdentifier = (source: string, identifier: string): number =>
  [...source.matchAll(new RegExp(`\\b${escaped(identifier)}\\b`, "g"))].length

const insertObject = (
  source: string,
  identifier: string,
  line: string,
  sectionEnd: string
): string => {
  const definition = new RegExp(
    `^[\\t ]*${escaped(identifier)}(?: /\\*[^\\n]*\\*/)? = \\{`,
    "gm"
  )
  const definitions = [...source.matchAll(definition)]
  if (definitions.length === 1) {
    expect(source.includes(line), `existing object ${identifier} does not match the overlay`)
    return source
  }
  expect(definitions.length === 0, `found ${definitions.length} definitions for ${identifier}`)
  expect(countIdentifier(source, identifier) === 0, `generated project already uses reserved id ${identifier}`)
  const markers = [...source.matchAll(new RegExp(escaped(sectionEnd), "g"))]
  expect(markers.length === 1, `expected one ${sectionEnd} marker, found ${markers.length}`)
  const at = markers[0]?.index
  expect(at !== undefined, `${sectionEnd} marker has no source position`)
  return source.slice(0, at) + `${line}\n` + source.slice(at)
}

const addListEntry = (
  source: string,
  objectID: string,
  listKey: string,
  identifier: string,
  comment: string
): string => {
  const list = assignmentRange(source, objectRange(source, objectID), listKey, "(", ")")
  const body = source.slice(list.open + 1, list.close)
  const held = countIdentifier(body, identifier)
  expect(held <= 1, `${objectID} ${listKey} contains ${identifier} ${held} times`)
  if (held === 1) return source

  const closingLine = source.lastIndexOf("\n", list.close) + 1
  const closingIndent = source.slice(closingLine, list.close)
  expect(/^[\t ]*$/.test(closingIndent), `${objectID} ${listKey} closing delimiter moved inline`)
  const addition = `${closingIndent}\t${identifier} /* ${comment} */,\n`
  return source.slice(0, closingLine) + addition + source.slice(closingLine)
}

const addPrivacyResources = (original: string): string => {
  let source = original
  for (const [kind, identifier] of Object.entries(privacyReferences)) {
    source = insertObject(
      source,
      identifier,
      `\t\t${identifier} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`,
      "/* End PBXFileReference section */"
    )
    const groupName = kind === "app" ? "Shared (App)" : "Shared (Extension)"
    const groupID = objectIdentifier(source, groupName, "PBXGroup")
    source = addListEntry(source, groupID, "children", identifier, "PrivacyInfo.xcprivacy")
  }

  for (const target of safariTargets) {
    const buildID = privacyBuildFiles.get(target.name)
    expect(buildID !== undefined, `missing reserved PrivacyInfo build id for ${target.name}`)
    const referenceID = privacyReferences[target.privacyKind]
    source = insertObject(
      source,
      buildID,
      `\t\t${buildID} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${referenceID} /* PrivacyInfo.xcprivacy */; };`,
      "/* End PBXBuildFile section */"
    )
    source = addListEntry(
      source,
      targetResourcePhase(source, target.name),
      "files",
      buildID,
      "PrivacyInfo.xcprivacy in Resources"
    )
  }
  return source
}

export const assertCustomizedProject = (source: string): void => {
  let configurations = 0
  for (const target of safariTargets) {
    const identifiers = configurationIdentifiers(source, target.name)
    for (const name of ["Debug", "Release"] as const) {
      const configurationID = identifiers[name]
      configurations += 1
      const expectedSettings: ReadonlyArray<readonly [string, string]> = [
        ["PRODUCT_BUNDLE_IDENTIFIER", target.bundleIdentifier],
        ["CODE_SIGN_ENTITLEMENTS", target.entitlementPath],
        [target.deploymentKey, target.deploymentValue],
        ["INFOPLIST_KEY_ITSAppUsesNonExemptEncryption", "NO"]
      ]
      for (const [key, expectedValue] of expectedSettings) {
        const actual = buildSetting(source, configurationID, key)
        expect(actual === expectedValue,
          `${target.name} ${name} ${key} is ${JSON.stringify(actual)}, expected ${expectedValue}`)
      }
    }
  }
  expect(configurations === 8, `patched ${configurations} target configurations instead of 8`)

  for (const [kind, referenceID] of Object.entries(privacyReferences)) {
    const reference = objectText(source, referenceID)
    expect(reference.includes("isa = PBXFileReference;"), `${kind} privacy reference is not a file`)
    expect(reference.includes("path = PrivacyInfo.xcprivacy;"), `${kind} privacy reference has wrong path`)
    const groupName = kind === "app" ? "Shared (App)" : "Shared (Extension)"
    const groupID = objectIdentifier(source, groupName, "PBXGroup")
    const children = assignmentRange(source, objectRange(source, groupID), "children", "(", ")")
    expect(countIdentifier(source.slice(children.open + 1, children.close), referenceID) === 1,
      `${groupName} does not contain exactly one PrivacyInfo reference`)
  }

  for (const target of safariTargets) {
    const buildID = privacyBuildFiles.get(target.name)
    expect(buildID !== undefined, `missing PrivacyInfo build id for ${target.name}`)
    const buildFile = objectText(source, buildID)
    expect(buildFile.includes(`fileRef = ${privacyReferences[target.privacyKind]} /* PrivacyInfo.xcprivacy */;`),
      `${target.name} PrivacyInfo build file points at the wrong manifest`)
    const phaseID = targetResourcePhase(source, target.name)
    const files = assignmentRange(source, objectRange(source, phaseID), "files", "(", ")")
    expect(countIdentifier(source.slice(files.open + 1, files.close), buildID) === 1,
      `${target.name} does not bundle PrivacyInfo.xcprivacy exactly once`)
  }
}

const customizeProjectText = (original: string): string => {
  const configurations = new Map<string, Readonly<Record<"Debug" | "Release", string>>>()
  for (const target of safariTargets) {
    configurations.set(target.name, configurationIdentifiers(original, target.name))
  }

  let source = original
  for (const target of safariTargets) {
    const identifiers = configurations.get(target.name)
    expect(identifiers !== undefined, `missing configurations for ${target.name}`)
    for (const name of ["Debug", "Release"] as const) {
      const identifier = identifiers[name]
      source = setBuildSetting(source, identifier, "PRODUCT_BUNDLE_IDENTIFIER", target.bundleIdentifier)
      source = setBuildSetting(source, identifier, "CODE_SIGN_ENTITLEMENTS", target.entitlementPath)
      source = setBuildSetting(source, identifier, target.deploymentKey, target.deploymentValue)
      source = setBuildSetting(
        source,
        identifier,
        "INFOPLIST_KEY_ITSAppUsesNonExemptEncryption",
        "NO"
      )
    }
  }
  source = addPrivacyResources(source)
  assertCustomizedProject(source)
  return source
}

const copiesFor = (projectRoot: string): ReadonlyArray<readonly [string, string]> => [
  [path.join(appleRoot, "ViewController.swift"), path.join(projectRoot, "Shared (App)/ViewController.swift")],
  [
    path.join(appleRoot, "SafariWebExtensionHandler.swift"),
    path.join(projectRoot, "Shared (Extension)/SafariWebExtensionHandler.swift")
  ],
  [path.join(appleRoot, "iOS-App.entitlements"), path.join(projectRoot, "iOS (App)/Parle.entitlements")],
  [
    path.join(appleRoot, "iOS-Extension.entitlements"),
    path.join(projectRoot, "iOS (Extension)/Parle.entitlements")
  ],
  [path.join(appleRoot, "macOS-App.entitlements"), path.join(projectRoot, "macOS (App)/Parle.entitlements")],
  [
    path.join(appleRoot, "macOS-Extension.entitlements"),
    path.join(projectRoot, "macOS (Extension)/Parle.entitlements")
  ],
  [path.join(appleRoot, "PrivacyInfo.xcprivacy"), path.join(projectRoot, "Shared (App)/PrivacyInfo.xcprivacy")],
  [
    path.join(appleRoot, "PrivacyInfo.xcprivacy"),
    path.join(projectRoot, "Shared (Extension)/PrivacyInfo.xcprivacy")
  ]
]

export const customizeSafariHost = (projectRoot: string): void => {
  const projectPath = path.join(projectRoot, "Parle.xcodeproj/project.pbxproj")
  expect(fs.existsSync(projectPath), `missing generated Xcode project: ${projectPath}`)
  const copies = copiesFor(projectRoot)
  for (const [source] of copies) {
    expect(fs.existsSync(source), `missing checked-in host overlay: ${source}`)
  }

  const customized = customizeProjectText(fs.readFileSync(projectPath, "utf8"))
  const temporary = `${projectPath}.parle-overlay.tmp`
  fs.rmSync(temporary, { force: true })
  fs.writeFileSync(temporary, customized)
  fs.renameSync(temporary, projectPath)

  for (const [source, destination] of copies) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
}

const invoked = process.argv[1]
if (invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(
    process.argv[2] ?? path.join(extensionRoot, ".output/safari-apple/Parle")
  )
  customizeSafariHost(projectRoot)
  console.log(`Customized Safari native host: ${projectRoot}`)
}
