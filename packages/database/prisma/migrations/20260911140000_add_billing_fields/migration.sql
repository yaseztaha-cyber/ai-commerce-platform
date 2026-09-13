ALTER TABLE "Plan" ADD COLUMN "priceEgp" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Subscription" ADD COLUMN "providerRef" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "providerCustomerToken" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "trialEndsAt" TIMESTAMPTZ;
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodStart" TIMESTAMPTZ;
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodEnd" TIMESTAMPTZ;
ALTER TABLE "Subscription" ADD COLUMN "lastProviderEvent" TIMESTAMPTZ;
CREATE UNIQUE INDEX "Subscription_providerRef_key" ON "Subscription"("providerRef");
