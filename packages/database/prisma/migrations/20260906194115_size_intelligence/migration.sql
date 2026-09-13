-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "preferredSize" TEXT;

-- CreateTable
CREATE TABLE "ProductMeasurement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "chest" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "shoulder" DOUBLE PRECISION,
    "sleeve" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductMeasurement_tenantId_productId_idx" ON "ProductMeasurement"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMeasurement_tenantId_productId_size_key" ON "ProductMeasurement"("tenantId", "productId", "size");

-- AddForeignKey
ALTER TABLE "ProductMeasurement" ADD CONSTRAINT "ProductMeasurement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMeasurement" ADD CONSTRAINT "ProductMeasurement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
