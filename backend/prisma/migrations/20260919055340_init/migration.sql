-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password` VARCHAR(200) NOT NULL,
    `nickname` VARCHAR(50) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'user',
    `status` INTEGER NOT NULL DEFAULT 1,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collect_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `url` VARCHAR(1000) NOT NULL,
    `scrolls` INTEGER NOT NULL DEFAULT 20,
    `step` INTEGER NOT NULL DEFAULT 900,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `total` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `logs` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `collect_tasks_status_idx`(`status`),
    INDEX `collect_tasks_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sku` VARCHAR(40) NOT NULL,
    `title` VARCHAR(500) NULL,
    `brand` VARCHAR(100) NULL,
    `categoryPath` VARCHAR(300) NULL,
    `category3Name` VARCHAR(200) NULL,
    `price` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'RUB',
    `sellerId` VARCHAR(40) NULL,
    `sellerName` VARCHAR(200) NULL,
    `sellerCountry` VARCHAR(50) NULL,
    `isChinaSeller` BOOLEAN NOT NULL DEFAULT false,
    `imageUrl` VARCHAR(1000) NULL,
    `productUrl` VARCHAR(1000) NULL,
    `rating` DECIMAL(3, 2) NULL,
    `reviewsCount` INTEGER NOT NULL DEFAULT 0,
    `salesSchema` VARCHAR(20) NULL,
    `sizeLengthMm` INTEGER NULL,
    `sizeWidthMm` INTEGER NULL,
    `sizeHeightMm` INTEGER NULL,
    `sizeWeightG` INTEGER NULL,
    `soldCount` INTEGER NULL,
    `soldSum` DECIMAL(14, 2) NULL,
    `drr` DECIMAL(6, 2) NULL,
    `daysWithTrafarets` INTEGER NULL,
    `convToCartPdp` DECIMAL(6, 2) NULL,
    `convToCartSearch` DECIMAL(6, 2) NULL,
    `cancelRate` DECIMAL(6, 2) NULL,
    `createDays` INTEGER NULL,
    `daysInPromo` INTEGER NULL,
    `discount` DECIMAL(6, 2) NULL,
    `raw` JSON NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_sku_key`(`sku`),
    INDEX `products_category3Name_idx`(`category3Name`),
    INDEX `products_soldCount_idx`(`soldCount`),
    INDEX `products_createDays_idx`(`createDays`),
    INDEX `products_lastSeenAt_idx`(`lastSeenAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_metrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `taskId` INTEGER NULL,
    `soldCount` INTEGER NULL,
    `soldSum` DECIMAL(14, 2) NULL,
    `drr` DECIMAL(6, 2) NULL,
    `daysWithTrafarets` INTEGER NULL,
    `convToCartPdp` DECIMAL(6, 2) NULL,
    `convToCartSearch` DECIMAL(6, 2) NULL,
    `cancelRate` DECIMAL(6, 2) NULL,
    `createDays` INTEGER NULL,
    `rating` DECIMAL(3, 2) NULL,
    `reviewsCount` INTEGER NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_metrics_productId_capturedAt_idx`(`productId`, `capturedAt`),
    INDEX `product_metrics_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `filter_presets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `rules` JSON NOT NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screening_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `presetId` INTEGER NULL,
    `taskId` INTEGER NULL,
    `presetName` VARCHAR(100) NOT NULL,
    `rules` JSON NOT NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `counts` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `screening_runs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screening_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `grade` INTEGER NOT NULL DEFAULT 0,
    `tier` VARCHAR(2) NOT NULL,
    `hardRules` JSON NULL,
    `reasons` JSON NULL,
    `notes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `screening_items_runId_grade_idx`(`runId`, `grade`),
    INDEX `screening_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `collect_tasks` ADD CONSTRAINT `collect_tasks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_metrics` ADD CONSTRAINT `product_metrics_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_metrics` ADD CONSTRAINT `product_metrics_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `collect_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `filter_presets` ADD CONSTRAINT `filter_presets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `screening_runs` ADD CONSTRAINT `screening_runs_presetId_fkey` FOREIGN KEY (`presetId`) REFERENCES `filter_presets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `screening_runs` ADD CONSTRAINT `screening_runs_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `collect_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `screening_items` ADD CONSTRAINT `screening_items_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `screening_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `screening_items` ADD CONSTRAINT `screening_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
