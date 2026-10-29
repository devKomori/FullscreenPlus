from pathlib import Path
import shutil
import json

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

BROWSERS = ["chrome", "firefox"]
DIRECTORIES = ["js", "html", "css", "imgs"]


# Ignore certain files in the js directory based on the browser build
def ignore_js(directory, files, browser):
    # Only apply exclusions to the root js directory
    if Path(directory).resolve() != ROOT / "js":
        return []

    if browser == "chrome":
        return ["firefox"]

    if browser == "firefox":
        return ["background.js", "volume.js"]

    return []


def build(browser):
    manifest = ROOT / "manifests" / f"manifest.{browser}.json"

    # Get version from manifest
    with open(manifest, "r", encoding="utf-8") as file:
        version = json.load(file)["version"]

    # Include version in build folder name
    output = DIST / f"fullscreenplus-{browser}-{version}"

    # Remove previous build with the same version
    if output.exists():
        shutil.rmtree(output)

    output.mkdir(parents=True)

    # Copy browser-specific manifest
    shutil.copy2(manifest, output / "manifest.json")

    # Copy extension files
    for directory in DIRECTORIES:
        source = ROOT / directory

        if source.exists():
            if directory == "js":
                shutil.copytree(
                    source,
                    output / directory,
                    ignore=lambda path, files: ignore_js(path, files, browser)
                )
            elif directory == "html" and browser == "firefox":
                shutil.copytree(
                    source,
                    output / directory,
                    ignore=shutil.ignore_patterns("offscreen.html")
                )
            else:
                shutil.copytree(source, output / directory)

    print(f"Built FullscreenPlus for {browser} v{version} -> {output}")


def main():
    for browser in BROWSERS:
        build(browser)

    print("\nAll builds completed successfully!")


if __name__ == "__main__":
    main()