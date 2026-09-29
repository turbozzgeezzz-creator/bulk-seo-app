-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "creditBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'FREE',
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "usedThisPeriod" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditPurchase_shop_idx" ON "CreditPurchase"("shop");
