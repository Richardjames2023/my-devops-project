import {PrismaClient} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../../config/env";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});


const prisma = new PrismaClient({
  adapter,
});

export async function connectToDatabase(): Promise<void> {
    await prisma.$connect();
    console.log("Connected to the database");
}
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log("Database disconnected");
}

export default prisma;