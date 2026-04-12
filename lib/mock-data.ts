import type {
  Supplier,
  Customer,
  PurchaseOrder,
  SalesOrder,
  InventoryItem,
  SupplierInvoice,
  CustomerInvoice,
  GoodsReceipt,
  Product,
} from "./types"

export const mockSuppliers: Supplier[] = [
  {
    id: "sup-1",
    name: "Aqua Tech Supplies",
    contactPerson: "John Smith",
    email: "john@aquatech.com",
    phone: "+1-555-0101",
    address: "123 Industrial Ave, Tech City, TC 12345",
    paymentTerms: "Net 30",
    status: "active",
  },
  {
    id: "sup-2",
    name: "Pump Masters Inc",
    contactPerson: "Sarah Johnson",
    email: "sarah@pumpmasters.com",
    phone: "+1-555-0102",
    address: "456 Manufacturing Blvd, Factory Town, FT 67890",
    paymentTerms: "Net 45",
    status: "active",
  },
]

export const mockCustomers: Customer[] = [
  {
    id: "cust-1",
    name: "City Water Works",
    contactPerson: "Mike Davis",
    email: "mike@citywater.gov",
    phone: "+1-555-0201",
    address: "789 Municipal Dr, Water City, WC 11111",
    creditLimit: 100000,
    paymentTerms: "Net 30",
    status: "active",
  },
  {
    id: "cust-2",
    name: "Industrial Solutions LLC",
    contactPerson: "Emily Chen",
    email: "emily@indsolutions.com",
    phone: "+1-555-0202",
    address: "321 Business Park, Commerce City, CC 22222",
    creditLimit: 75000,
    paymentTerms: "Net 45",
    status: "active",
  },
]

export const mockProducts: Product[] = [
  {
    id: "prod-1",
    productName: "Centrifugal Water Pump 5HP",
    sku: "CWP-5HP-001",
    category: "Pumps",
    unitPrice: 850,
    reorderLevel: 10,
    desiredExcess: 15,
    supplierId: "sup-1",
  },
  {
    id: "prod-2",
    productName: "Submersible Pump 3HP",
    sku: "SUB-3HP-002",
    category: "Pumps",
    unitPrice: 650,
    reorderLevel: 8,
    desiredExcess: 12,
    supplierId: "sup-2",
  },
  {
    id: "prod-3",
    productName: "Industrial Pump 10HP",
    sku: "IND-10HP-003",
    category: "Pumps",
    unitPrice: 1500,
    reorderLevel: 5,
    desiredExcess: 10,
    supplierId: "sup-1",
  },
]

export const mockInventory: InventoryItem[] = [
  {
    id: "inv-1",
    productName: "Centrifugal Water Pump 5HP",
    sku: "CWP-5HP-001",
    quantity: 25,
    reorderLevel: 10,
    unitCost: 850,
    totalValue: 21250,
    location: "Warehouse - Main",
  },
  {
    id: "inv-2",
    productName: "Submersible Pump 3HP",
    sku: "SUB-3HP-002",
    quantity: 15,
    reorderLevel: 8,
    unitCost: 650,
    totalValue: 9750,
    location: "Warehouse - Main",
  },
  {
    id: "inv-3",
    productName: "Industrial Pump 10HP",
    sku: "IND-10HP-003",
    quantity: 8,
    reorderLevel: 5,
    unitCost: 1500,
    totalValue: 12000,
    location: "Warehouse - Main",
  },
]

export const mockPurchaseOrders: PurchaseOrder[] = []

export const mockSalesOrders: SalesOrder[] = []

export const mockSupplierInvoices: SupplierInvoice[] = []

export const mockCustomerInvoices: CustomerInvoice[] = []

export const mockGoodsReceipts: GoodsReceipt[] = []
