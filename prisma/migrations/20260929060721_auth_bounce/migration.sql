-- CreateTable
CREATE TABLE "AuthBounce" (
    "shop" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthBounce_pkey" PRIMARY KEY ("shop")
);
