-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BulkJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ONLY_MISSING',
    "status" TEXT NOT NULL DEFAULT 'SCANNING',
    "scanCursor" TEXT,
    "scanComplete" BOOLEAN NOT NULL DEFAULT false,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "claimedUntil" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "BulkJobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "before" TEXT,
    "after" TEXT,
    "error" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BulkJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BulkJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BulkJob_shop_createdAt_idx" ON "BulkJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "BulkJob_status_idx" ON "BulkJob"("status");

-- CreateIndex
CREATE INDEX "BulkJobItem_jobId_status_idx" ON "BulkJobItem"("jobId", "status");

-- CreateIndex
CREATE INDEX "BulkJobItem_shop_idx" ON "BulkJobItem"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BulkJobItem_jobId_productId_mediaId_key" ON "BulkJobItem"("jobId", "productId", "mediaId");
