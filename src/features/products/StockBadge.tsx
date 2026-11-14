import { Badge } from '../../components/ui'
import { stockLevel, type Product } from '../../lib/types'

export function StockBadge({ product }: { product: Pick<Product, 'stock_qty' | 'low_stock_threshold'> }) {
  const level = stockLevel(product)
  if (level === 'out') return <Badge tone="red">Out of stock</Badge>
  if (level === 'low') return <Badge tone="amber">Low · {product.stock_qty} left</Badge>
  return <Badge tone="green">{product.stock_qty} in stock</Badge>
}
