# GeoPortal Desktop

Desktop packaging of the supplied GeoPortal Java/Tomcat application for Windows and macOS.

## What this desktop edition does

- Opens GeoPortal in a native Electron desktop window.
- Starts an embedded Apache Tomcat 9 server bound only to `127.0.0.1`.
- Deploys the supplied `geoportal.war` automatically as `/geoportal/`.
- Stores uploads/results in the logged-in user's application data folder instead of Tomcat temporary storage.
- Supports the existing `/geoportal/api/*` Servlet API without changing the compiled Java backend.
- Detects and configures GDAL, OGR, PDAL, Python, and `gdal_calc` from a bundled conda-forge GIS runtime.
- Falls back to common system GIS installations if a bundled runtime is unavailable.
- Adds desktop menu actions for Home, GIS Workspace, Data Folder, Log File, and Diagnostics.

## Installer outputs

The included GitHub Actions workflow builds:

- `GeoPortal-Desktop-1.0.0-Windows-x64.exe`
- `GeoPortal-Desktop-1.0.0-macOS-x64.dmg`
- `GeoPortal-Desktop-1.0.0-macOS-arm64.dmg`

The macOS packages are unsigned development builds unless Apple Developer signing/notarization credentials are added to the workflow/repository.

## Build locally

Requirements: Node.js 22+, JDK 17+, and internet access for the runtime preparation step.

### Windows

```powershell
npm install
./scripts/prepare-runtime.ps1
./scripts/prepare-gis-runtime.ps1
npm run dist:win
```

### macOS

```bash
npm install
./scripts/prepare-runtime.sh
./scripts/prepare-gis-runtime.sh
npm run dist:mac:x64       # Intel
npm run dist:mac:arm64     # Apple Silicon
```

## Automatic build without local compiler setup

Push this folder to GitHub and run **Actions → Build GeoPortal Desktop → Run workflow**. The workflow prepares Tomcat, a Java runtime, and a conda-forge GIS runtime (`gdal`, `ogr2ogr`, `pdal`, Python/GDAL Calc), then uploads the Windows and macOS installer artifacts.

## Runtime locations

The desktop wrapper sets `GEOPORTAL_DATA_DIR` to a persistent per-user data folder. Use **GeoPortal → Open Data Folder** from the application menu to open it.

A startup/runtime log is written as `geoportal-desktop.log` under the Electron user-data directory and can be opened from **GeoPortal → Open Log File**.

## Source web application

The original supplied web application is retained under `webapp/`. The packaged WAR is `resources/geoportal.war`.

If the web files are edited, rebuild the WAR from the project root:

```bash
cd webapp
jar --create --file ../resources/geoportal.war .
```

## Notes

- Internet is still required for online basemaps and CDN-hosted OpenLayers/jsPDF/shpjs assets used by the current web app.
- For a completely offline edition, vendor those JavaScript/CSS assets locally and add offline basemap data.
- macOS distribution outside your own machines should be code-signed and notarized with an Apple Developer ID.
