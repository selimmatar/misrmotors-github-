"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface Product {
  id: string
  productName: string
  sku?: string
}

interface InventoryItem {
  productId: string
  quantity: number
}

interface ProductSearchComboboxProps {
  products: Product[]
  inventory?: InventoryItem[]
  warehouseId?: string | null
  value?: string
  onSelect: (productId: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function ProductSearchCombobox({
  products,
  inventory = [],
  warehouseId,
  value,
  onSelect,
  disabled = false,
  placeholder = "Search product by name or SKU...",
  className,
}: ProductSearchComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")

  // Get available quantity for a product in the selected warehouse
  const getAvailableQuantity = (productId: string): number => {
    if (!warehouseId || !inventory || inventory.length === 0) return 0
    const invItem = inventory.find(
      (item) => item.productId === productId
    )
    return invItem?.quantity || 0
  }
  
  // Debug logging
  React.useEffect(() => {
    if (warehouseId && inventory) {
    }
  }, [warehouseId, inventory, products])

  // Filter products by search query (name or SKU)
  const filteredProducts = React.useMemo(() => {
    if (!searchQuery) return products

    const query = searchQuery.toLowerCase()
    return products.filter(
      (product) =>
        product.productName.toLowerCase().includes(query) ||
        (product.sku && product.sku.toLowerCase().includes(query))
    )
  }, [products, searchQuery])

  // Get the selected product
  const selectedProduct = products.find((p) => p.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between",
            !value && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          {selectedProduct ? (
            <span className="flex items-center gap-2 truncate">
              <span className="truncate">{selectedProduct.productName}</span>
              {selectedProduct.sku && (
                <span className="text-muted-foreground text-xs">({selectedProduct.sku})</span>
              )}
              {warehouseId && (
                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-auto">
                  {getAvailableQuantity(value!)} in stock
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to search..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {filteredProducts.map((product) => {
                const qty = warehouseId ? getAvailableQuantity(product.id) : null
                const hasStock = qty === null || qty > 0

                return (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={(currentValue) => {
                      onSelect(currentValue === value ? "" : currentValue)
                      setOpen(false)
                      setSearchQuery("")
                    }}
                    className={!hasStock ? "opacity-60" : ""}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === product.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{product.productName}</span>
                        {product.sku && (
                          <span className="text-muted-foreground text-xs">({product.sku})</span>
                        )}
                      </div>
                      {qty !== null && (
                        <span className={cn(
                          "text-xs",
                          qty > 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {qty > 0 ? `${qty} available` : "Out of stock"}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
