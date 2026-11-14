-- =====================================================================
-- Event POS — seed data (sample products). Safe to re-run: existing SKUs are skipped.
-- Run AFTER the migrations. Delete / replace with your real stock via CSV import.
-- =====================================================================

update public.settings
   set event_name = 'Winter Expo Sale',
       event_start_date = coalesce(event_start_date, current_date),
       receipt_header = 'Hall B, Stall 12' || chr(10) || 'Tel: 0300-0000000',
       receipt_footer = 'Thank you for shopping with us!' || chr(10) || 'Exchange within 3 days with receipt.'
 where id = 1;

with new_products as (
  insert into public.products (sku, name, category, price, stock_qty, low_stock_threshold) values
    ('APP-001', 'Cotton Kurta - Men',          'Apparel',     2450, 40, 5),
    ('APP-002', 'Lawn Suit 3pc',               'Apparel',     3950, 30, 5),
    ('APP-003', 'Embroidered Shawl',           'Apparel',     4800, 15, 3),
    ('APP-004', 'Kids T-Shirt',                'Apparel',      850, 60, 10),
    ('APP-005', 'Denim Jacket',                'Apparel',     5200, 12, 3),
    ('APP-006', 'Woolen Scarf',                'Apparel',     1250, 35, 5),
    ('APP-007', 'Cotton Socks (3 pairs)',      'Apparel',      600, 80, 10),
    ('APP-008', 'Hoodie - Unisex',             'Apparel',     3400, 4, 5),
    ('FTW-001', 'Peshawari Chappal',           'Footwear',    3200, 20, 4),
    ('FTW-002', 'Khussa - Women',              'Footwear',    2100, 25, 4),
    ('FTW-003', 'Sports Sneakers',             'Footwear',    6500, 8, 3),
    ('FTW-004', 'Kids Sandals',                'Footwear',    1150, 0, 4),
    ('ACC-001', 'Leather Wallet',              'Accessories', 1800, 30, 5),
    ('ACC-002', 'Handbag - Tote',              'Accessories', 4200, 10, 3),
    ('ACC-003', 'Sunglasses',                  'Accessories', 1500, 25, 5),
    ('ACC-004', 'Bangles Set',                 'Accessories',  750, 50, 10),
    ('ACC-005', 'Wrist Watch',                 'Accessories', 5800, 6, 2),
    ('ACC-006', 'Leather Belt',                'Accessories', 1350, 2, 4),
    ('HOM-001', 'Cushion Cover (pair)',        'Home',         950, 40, 8),
    ('HOM-002', 'Bedsheet Set - Double',       'Home',        3600, 18, 4),
    ('HOM-003', 'Ceramic Mug',                 'Home',         550, 70, 10),
    ('HOM-004', 'Scented Candle',              'Home',         890, 45, 8),
    ('HOM-005', 'Table Runner',                'Home',        1250, 20, 4),
    ('HOM-006', 'Wall Clock',                  'Home',        2700, 9, 3),
    ('BTY-001', 'Herbal Soap',                 'Beauty',       350, 100, 15),
    ('BTY-002', 'Hair Oil 200ml',              'Beauty',       650, 60, 10),
    ('BTY-003', 'Perfume 50ml',                'Beauty',      2950, 22, 5),
    ('BTY-004', 'Lip Balm',                    'Beauty',       300, 3, 10),
    ('BTY-005', 'Face Cream',                  'Beauty',      1100, 30, 6),
    ('FOD-001', 'Dry Fruit Box 500g',          'Food',        2200, 25, 5),
    ('FOD-002', 'Honey 500g',                  'Food',        1600, 30, 6),
    ('FOD-003', 'Chai Masala',                 'Food',         450, 50, 10),
    ('FOD-004', 'Dates 1kg',                   'Food',        1400, 40, 8),
    ('FOD-005', 'Mineral Water',               'Food',          80, 200, 30),
    ('TOY-001', 'Wooden Puzzle',               'Toys',         990, 20, 4),
    ('TOY-002', 'Soft Teddy Bear',             'Toys',        1700, 15, 4),
    ('TOY-003', 'Remote Control Car',          'Toys',        3900, 5, 2),
    ('STA-001', 'Notebook A5',                 'Stationery',   300, 90, 15),
    ('STA-002', 'Pen Set',                     'Stationery',   450, 60, 10),
    ('STA-003', 'Gift Wrap',                   'Stationery',   150, 120, 20)
  on conflict (sku) do nothing
  returning id, stock_qty
)
insert into public.stock_movements (product_id, delta, qty_after, type, reason)
select id, stock_qty, stock_qty, 'initial', 'Seed data'
  from new_products
 where stock_qty > 0;
