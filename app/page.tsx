import { HomeClient } from "@/components/home/home-client"

export default function Home() {
  return (
    <>
      <section className="sr-only">
        <h1>Misr Motors | مصر موتورز</h1>
        <p>
          Misr Motors is an automotive dealership and workshop management system covering vehicle sales, spare parts
          inventory, service orders, customers, suppliers, invoicing and reporting.
        </p>
        <p>
          مصر موتورز هو نظام لإدارة معارض وورش السيارات يشمل مبيعات السيارات وقطع الغيار والمخزون وأوامر الصيانة
          والعملاء والموردين والفواتير والتقارير.
        </p>
        <p>Staff sign in to access the system.</p>
      </section>
      <noscript>
        <p>Misr Motors requires JavaScript to sign in and use the management system.</p>
      </noscript>
      <HomeClient />
    </>
  )
}
