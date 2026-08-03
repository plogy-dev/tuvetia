"use client";

import { useEffect } from "react";
import Image from "next/image";
import { initLanding } from "@/lib/landing/engine";
import Background from "./Background";
import Nav from "./Nav";
import Hero from "./Hero";
import DemoStage from "./DemoStage";
import MediaBand from "./MediaBand";
import Criterio from "./Criterio";
import Conversacion from "./Conversacion";
import Salida from "./Salida";
import Cuenta from "./Cuenta";
import Seguridad from "./Seguridad";
import Nosotros from "./Nosotros";
import Oferta from "./Oferta";
import Faq from "./Faq";
import DemoCta from "./DemoCta";
import SiteFooter from "./SiteFooter";
import CalcModal from "./CalcModal";
import hero from "@/public/media/hero.png";
import bandaConsulta from "@/public/media/banda-consulta.png";

export default function Landing() {
  useEffect(() => initLanding(), []);

  return (
    <>
      <Background />
      <Nav />
      <div className="md-hero" aria-hidden="true">
        <Image src={hero} alt="" fill priority placeholder="blur" sizes="100vw" />
      </div>
      <div className="wrap">
        <Hero />
        <DemoStage />
        <MediaBand
          src={bandaConsulta}
          caption="La consulta"
          alt="Veterinario examinando a un perro sobre la mesa de consulta, con su dueña al frente"
        />
        <Criterio />
        {/* Oculta por pedido: banda del slot 4 (teléfono a las 10 de la noche), con
            `banda-whatsapp.png` y el alt "Veterinario mirando el teléfono en el sofá, de noche". */}
        <Conversacion />
        {/* Oculto por ahora: la subsección "Adentro del producto" (`./Producto`) y su banda
            (`banda-producto.png`, "Consultorio veterinario en calma, un gato sobre la mesa de
            acero"). Los imports se quitaron —eran 3 de los 12 warnings de lint y las dos imágenes
            se cargaban para nada—, así que reponer cualquiera de las dos secciones es reponer
            también su import. El markup exacto está en el historial de este archivo. */}
        <Salida />
        <Cuenta />
        <Seguridad />
        <Nosotros />
        <Oferta />
        <Faq />
        <DemoCta />
        <SiteFooter />
      </div>
      <CalcModal />
    </>
  );
}
