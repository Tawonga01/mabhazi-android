import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const VALID_PLACE_TYPES = new Set([
  "city",
  "town",
  "suburb",
  "village",
  "hamlet",
  "township",
]);

type GeoJsonFeature = {
  type: string;
  properties: Record<string, string | undefined>;
};

type GeoJson = {
  features: GeoJsonFeature[];
};

const geoJsonPath = join(__dirname, "../../../attached_assets/Zim_1780767722131.geojson");
const raw = readFileSync(geoJsonPath, "utf-8");
const geoJson: GeoJson = JSON.parse(raw);

const seen = new Set<string>();
const cities: { name: string; placeType: string }[] = [];

for (const feature of geoJson.features) {
  const name = feature.properties["name"]?.trim();
  const place = feature.properties["place"];
  if (!name || !place || !VALID_PLACE_TYPES.has(place)) continue;
  const key = name.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  cities.push({ name, placeType: place });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  await pool.query("BEGIN");
  await pool.query("LOCK TABLE cities IN EXCLUSIVE MODE");
  const existing = await pool.query("SELECT name, place_type FROM cities ORDER BY lower(name)");
  if (existing.rows.length > 0) {
    const expected = new Map(cities.map(city => [city.name, city.placeType]));
    if (existing.rows.length !== cities.length || existing.rows.some(row => expected.get(row.name) !== row.place_type)) {
      throw new Error("Existing city reference data differs; review before replacing it.");
    }
    await pool.query("COMMIT");
    console.log("City reference data already matches.");
    process.exitCode = 0;
  } else {

  console.log(`Inserting ${cities.length} cities...`);
  const BATCH = 100;
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH);
    const values = batch
      .map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`)
      .join(", ");
    const params = batch.flatMap((r) => [r.name, r.placeType]);
    await pool.query(
      `INSERT INTO cities (name, place_type) VALUES ${values}`,
      params,
    );
  }

  await pool.query("COMMIT");
  console.log(`Done — ${cities.length} cities seeded.`);
  }
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
