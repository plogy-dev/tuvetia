import type { Metadata } from "next";
import DemoPage from "@/components/subpages/DemoPage";
import "@/app/subpages.css";

export const metadata: Metadata = {
  title: "Agenda una demo · Tuvetia",
  description:
    "20 minutos. Traes un caso real, lo cuentas en voz alta, y ves la ficha escribirse sola. Te escribe un fundador, no un vendedor.",
};

export default function Page() {
  return <DemoPage />;
}
