# Raw data

Files here are downloaded by hand and never committed (see `.gitignore`).

## Database of British and Irish Hills (DoBIH)

1. Download the csv version (`hillcsv.zip`) from <https://www.hills-database.co.uk/downloads.html>.
2. Unzip it into this folder (`data/raw/`). Keep the downloaded name, e.g. `DoBIH_v18_6.csv`: the
   build finds the only `.csv` here and reads the version from its name. `DoBIH.csv` also works,
   with `DOBIH_VERSION` set in `.env`.
3. Keep only one CSV here. To update, replace it with the new download and rebuild.

Licence: CC BY 4.0. Attribution: "Database of British and Irish Hills (DoBIH) vX.Y".
