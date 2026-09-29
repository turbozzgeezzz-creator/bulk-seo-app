-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "path" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthEvent_shop_at_idx" ON "AuthEvent"("shop", "at");
