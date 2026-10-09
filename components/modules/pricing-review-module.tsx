"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/lib/i18n-context"
import { PageHeader } from "@/components/erp/page-header"
import { Money } from "@/components/erp/money"
import { DollarSign, TrendingUp, Package, Calculator } from "lucide-react"

type PricingProduct = {
  productId: number
  productName: string
  sku: string
  currentUnitPrice: number
  currentMarkup: number
  purchaseHistory: Array<{
    poNumber: string
    poDate: string
    quantity: number
    unitPrice: number
    allocatedTax: number
    allocatedOverhead: number
    landedCost: number
    landedCostPerUnit: number
  }>
}

type PricingReviewModuleProps = {
  userRole: string
}

export function PricingReviewModule({ userRole }: PricingReviewModuleProps) {
  const { t, formatNumber, language } = useI18n()
  const [products, setProducts] = useState<PricingProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pricingData, setPricingData] = useState<Record<number, { markup: number; price: number }>>({})

  useEffect(() => {
    fetchPendingPricing()
  }, [])

  const fetchPendingPricing = async () => {
    try {
      const response = await fetch("/api/purchase-orders/pending-pricing")
      const data = await response.json()
      setProducts(data || [])

      const initial: Record<number, { markup: number; price: number }> = {}
      ;(data || []).forEach((product: PricingProduct) => {
        const latestPurchase = product.purchaseHistory[0]
        const avgLandedCost = latestPurchase?.landedCostPerUnit || 0

        initial[product.productId] = {
          markup: product.currentMarkup || 0,
          price: product.currentUnitPrice || avgLandedCost * 1.2,
        }
      })
      setPricingData(initial)
    } catch (error) {
      console.error("Error fetching pending pricing:", error)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const handleMarkupChange = (productId: number, markup: number, landedCost: number) => {
    const newPrice = landedCost * (1 + markup / 100)
    setPricingData({
      ...pricingData,
      [productId]: { markup, price: Number(newPrice.toFixed(2)) },
    })
  }

  const handlePriceChange = (productId: number, price: number, landedCost: number) => {
    const newMarkup = landedCost > 0 ? ((price - landedCost) / landedCost) * 100 : 0
    setPricingData({
      ...pricingData,
      [productId]: { markup: Number(newMarkup.toFixed(2)), price },
    })
  }

  const handleSavePricing = async () => {
    setSaving(true)
    try {
      const updates = products.map((product) => {
        const latestPurchase = product.purchaseHistory[0]
        const landedCostPerUnit = latestPurchase?.landedCostPerUnit || 0
        const pricing = pricingData[product.productId]

        return {
          productId: product.productId,
          lastLandedCost: landedCostPerUnit,
          markupPercentage: pricing.markup,
          unitPrice: pricing.price,
        }
      })

      const response = await fetch("/api/products/update-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, userId: 1 }),
      })

      if (response.ok) {
        alert(t("pricing.updated"))
        fetchPendingPricing()
      } else {
        throw new Error("Failed to update pricing")
      }
    } catch (error) {
      console.error("Error saving pricing:", error)
      alert(t("pricing.error"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-center">{t("action.loading")}</div>
  }

  if (products.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("pricing.title")}</CardTitle>
          <CardDescription>{t("pricing.no-products")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("pricing.no-products-note")}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        group={t("group.purchasing")}
        title={t("module.pricing-review")}
        actions={
          <Button onClick={handleSavePricing} disabled={saving} size="lg">
            <DollarSign className="w-4 h-4 me-2" />
            {saving ? t("action.saving") : t("pricing.save-all")}
          </Button>
        }
      />

      <div className="grid gap-6">
        {products.map((product) => {
          const latestPurchase = product.purchaseHistory[0]
          const landedCostPerUnit = latestPurchase?.landedCostPerUnit || 0
          const pricing = pricingData[product.productId] || { markup: 0, price: 0 }
          const margin = pricing.price > 0 ? ((pricing.price - landedCostPerUnit) / pricing.price) * 100 : 0

          return (
            <Card key={product.productId}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{product.productName}</CardTitle>
                    <CardDescription>
                      {t("field.sku")}: {product.sku}
                    </CardDescription>
                  </div>
                  <div className="text-end">
                    <div className="text-sm text-muted-foreground">{t("pricing.current-price")} (EGP)</div>
                    <div className="text-2xl font-bold">
                      <Money value={product.currentUnitPrice} />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Purchase History */}
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="w-4 h-4" />
                    <h3 className="font-semibold">{t("pricing.recent-purchase")}</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">{t("pricing.po-number")}</div>
                      <div className="font-medium">{latestPurchase.poNumber}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("pricing.base-cost")} (EGP)</div>
                      <div className="font-medium">
                        <Money value={latestPurchase.unitPrice} />
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("pricing.tax-overhead")} (EGP)</div>
                      <div className="font-medium">
                        <Money value={latestPurchase.allocatedOverhead} />
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("pricing.landed-cost")} (EGP)</div>
                      <div className="font-bold text-lg">
                        <Money value={landedCostPerUnit} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pricing Controls */}
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    <Label htmlFor={`markup-${product.productId}`} className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      {t("pricing.markup")}
                    </Label>
                    <Input
                      id={`markup-${product.productId}`}
                      type="number"
                      value={pricing.markup}
                      onChange={(e) => handleMarkupChange(product.productId, Number(e.target.value), landedCostPerUnit)}
                      step="0.1"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`price-${product.productId}`} className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      {t("pricing.sale-price")}
                    </Label>
                    <Input
                      id={`price-${product.productId}`}
                      type="number"
                      value={pricing.price}
                      onChange={(e) => handlePriceChange(product.productId, Number(e.target.value), landedCostPerUnit)}
                      step="0.01"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="flex items-center gap-2">
                      <Calculator className="w-4 h-4" />
                      {t("pricing.profit-margin")}
                    </Label>
                    <div className="mt-1 h-10 flex items-center px-3 border rounded-md bg-muted">
                      <span className="font-semibold">{formatNumber(margin)}%</span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    {t("pricing.profit-per-unit")} (EGP):{" "}
                    <span className="font-semibold text-foreground">
                      <Money value={pricing.price - landedCostPerUnit} />
                    </span>
                  </div>
                  {pricing.price < landedCostPerUnit && (
                    <div className="text-sm text-red-600 font-semibold">⚠️ {t("pricing.below-cost")}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
