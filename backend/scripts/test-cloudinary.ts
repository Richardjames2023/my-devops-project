import "dotenv/config";
import { getCloudinary } from "../src/config/cloudinary";

async function main() {
  const cloudinary = getCloudinary();
  const result = await cloudinary.api.ping();

  console.log("Cloudinary connection successful:", result.status);
}

main().catch((error: unknown) => {
  console.error("Cloudinary connection failed:", error);
  process.exitCode = 1;
});