-- CreateTable
CREATE TABLE "monthly_insights" (
    "id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "insights" JSONB NOT NULL,
    "analytics_fingerprint" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_insights_month_key" ON "monthly_insights"("month");
