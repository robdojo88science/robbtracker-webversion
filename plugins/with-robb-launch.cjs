// Run after Expo's splash, Info.plist, and Xcode mods have written their files.
// Versioned launch resources stop an updated app from reusing an older iOS launch snapshot.
const { withFinalizedMod } = require("expo/config-plugins");
const {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} = require("node:path");
const plistModule = require("@expo/plist");
const plist = plistModule.default || plistModule;

function launchBranding(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Launch branding requires a numeric app version.");
  const suffix = version.replaceAll(".", "_");
  return {
    storyboard: `RobbTrackerLaunchV${suffix}`,
    image: `RobbTrackerSplashV${suffix}`,
    marker: `R-blue-v${version.split(".").slice(0, 2).join(".")}`,
  };
}

// function checkedPath(projectRoot, candidate) {
//   const root = realpathSync(resolve(projectRoot)), target = resolve(candidate);
//   const outside = value => { const part = relative(root, value); return part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part); };
//   if (outside(target)) throw new Error('Launch branding path must stay within the project root.');
//   let ancestor = target;
//   while (!existsSync(ancestor)) { const parent = dirname(ancestor); if (parent === ancestor) throw new Error('Cannot resolve the launch branding path.'); ancestor = parent; }
//   if (outside(realpathSync(ancestor))) throw new Error('Launch branding refuses a path linked outside the project root.');
//   return target;
// }
function checkedPath(projectRoot, candidate) {
  const root = realpathSync(resolve(projectRoot));
  const target = resolve(candidate);

  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing)
      throw new Error("Cannot resolve the launch branding path.");
    existing = parent;
  }

  const resolvedTarget = realpathSync(existing);
  const relativeToRoot = relative(root, resolvedTarget);
  const outside =
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot);

  if (outside)
    throw new Error("Launch branding path must stay within the project root.");

  return target;
}
function copyImageSet(root, source, destination) {
  checkedPath(root, source);
  checkedPath(root, destination);
  if (lstatSync(source).isSymbolicLink())
    throw new Error("Launch branding images must be regular project files.");
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const input = checkedPath(root, join(source, entry.name)),
      output = checkedPath(root, join(destination, entry.name));
    if (entry.isSymbolicLink())
      throw new Error("Launch branding images must be regular project files.");
    if (entry.isDirectory()) copyImageSet(root, input, output);
    else if (entry.isFile()) copyFileSync(input, output);
    else throw new Error("Unsupported launch image file.");
  }
}

function applyLaunchBranding({
  projectRoot,
  platformProjectRoot,
  projectName,
  version,
  introspect = false,
}) {
  if (introspect) return null;
  const names = launchBranding(version);
  if (
    typeof projectName !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(projectName)
  )
    throw new Error(
      "Launch branding requires a safe generated iOS project name.",
    );
  const root = realpathSync(resolve(projectRoot)),
    ios = checkedPath(root, platformProjectRoot || join(root, "ios"));
  const source = checkedPath(root, join(ios, projectName));
  const originalStoryboard = checkedPath(
    root,
    join(source, "SplashScreen.storyboard"),
  );
  const newStoryboard = checkedPath(
    root,
    join(source, `${names.storyboard}.storyboard`),
  );
  const projectFile = checkedPath(
    root,
    join(ios, `${projectName}.xcodeproj`, "project.pbxproj"),
  );
  const infoFile = checkedPath(root, join(source, "Info.plist"));
  const sourceImageSet = checkedPath(
    root,
    join(source, "Images.xcassets", "SplashScreenLogo.imageset"),
  );
  const newImageSet = checkedPath(
    root,
    join(source, "Images.xcassets", `${names.image}.imageset`),
  );
  const info = plist.parse(readFileSync(infoFile, "utf8"));
  if (info.RobbTrackerBrand !== names.marker)
    throw new Error(
      `RobbTrackerBrand must be ${names.marker}; refusing stale or differently branded launch assets.`,
    );
  const storyboard = readFileSync(originalStoryboard, "utf8");
  if (!/\bSplashScreenLogo\b/.test(storyboard))
    throw new Error(
      "The generated launch storyboard is missing its splash image.",
    );
  const project = readFileSync(projectFile, "utf8");
  const updatedProject = project.replace(
    /(?:SplashScreen|RobbTrackerLaunchV\d+_\d+_\d+)\.storyboard/g,
    `${names.storyboard}.storyboard`,
  );
  if (!updatedProject.includes(`${names.storyboard}.storyboard`))
    throw new Error(
      "The generated Xcode project is missing its launch storyboard resource.",
    );
  const contents = JSON.parse(
    readFileSync(
      checkedPath(root, join(sourceImageSet, "Contents.json")),
      "utf8",
    ),
  );
  const images = Array.isArray(contents.images)
    ? contents.images.filter((image) => typeof image.filename === "string")
    : [];
  if (!images.length)
    throw new Error("The generated splash image set has no images.");
  for (const image of images) {
    if (!/^[A-Za-z0-9_@.-]+\.png$/i.test(image.filename))
      throw new Error("Unsafe generated splash image filename.");
    const file = checkedPath(root, join(sourceImageSet, image.filename));
    if (!statSync(file).isFile() || statSync(file).size === 0)
      throw new Error("A generated splash image is missing or empty.");
  }
  // Keep Expo's originals for repeat prebuilds; only the versioned resource is referenced by Xcode.
  copyImageSet(root, sourceImageSet, newImageSet);
  writeFileSync(
    newStoryboard,
    storyboard.replace(/\bSplashScreenLogo\b/g, names.image),
  );
  writeFileSync(projectFile, updatedProject);
  info.UILaunchStoryboardName = names.storyboard;
  info.RobbTrackerLaunchAsset = names.image;
  writeFileSync(infoFile, plist.build(info));
  return names;
}

function validateCompiledLaunchBranding(info, version, appPath) {
  const names = launchBranding(version);
  for (const [key, expected] of Object.entries({
    RobbTrackerBrand: names.marker,
    UILaunchStoryboardName: names.storyboard,
    RobbTrackerLaunchAsset: names.image,
  })) {
    if (info[key] !== expected)
      throw new Error(
        `Refusing stale iOS launch branding: ${key} must be ${expected}.`,
      );
  }
  const root = realpathSync(resolve(appPath));
  const resources = [
    join(root, `${names.storyboard}.storyboardc`),
    join(root, "Base.lproj", `${names.storyboard}.storyboardc`),
  ];
  if (
    !resources.some((file) => {
      checkedPath(root, file);
      return (
        existsSync(file) &&
        statSync(file).isDirectory() &&
        readdirSync(file).length > 0
      );
    })
  )
    throw new Error(
      "The compiled app is missing its versioned launch storyboard.",
    );
}

function withRobbLaunch(config) {
  return withFinalizedMod(config, [
    "ios",
    async (next) => {
      const request = next.modRequest;
      applyLaunchBranding({
        projectRoot: request.projectRoot,
        platformProjectRoot: request.platformProjectRoot,
        projectName: request.projectName,
        version: next.version,
        introspect: request.introspect,
      });
      return next;
    },
  ]);
}

module.exports = withRobbLaunch;
module.exports.launchBranding = launchBranding;
module.exports.applyLaunchBranding = applyLaunchBranding;
module.exports.validateCompiledLaunchBranding = validateCompiledLaunchBranding;
