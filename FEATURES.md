# Features — qué puede hacer el usuario en Tuvetia

Lista de todo lo que una persona puede hacer dentro de la app, sección por sección, contada como
historias de usuario. No hay nada técnico acá: no se habla de rutas, tablas ni proveedores. Si
buscás el detalle de implementación y de costos, eso está en [FUNCIONALIDADES.md](FUNCIONALIDADES.md).

**Cómo leerlo.** Cada viñeta es algo que el usuario puede hacer hoy. Cuando algo depende del rol se
marca **(admin)**: solo el administrador de la clínica puede hacerlo. Cuando algo requiere el plan
pago se marca **(Pro)**. Lo que todavía no está disponible está al final, en su propia sección.

> Actualizado contra el estado del repositorio al **2026-08-17**.

---

## Los dos planes

| | **Gratis** | **Pro** |
|---|---|---|
| Precio | $0, para siempre | $200.000 COP / mes |
| Qué incluye | Pacientes · Agenda · Ventas · Comunicaciones · Dashboard · Integraciones · Configuración | todo lo anterior, más las siete funciones marcadas **(Pro)** |

El plan es **por clínica** —todos los miembros comparten lo mismo— y solo el administrador puede
contratarlo o cancelarlo. Se gestiona desde **Plan**, en el menú de tu perfil.

Lo que separa a los dos planes es una sola cosa: **si la función usa inteligencia artificial**. Todo
lo demás es gratis y sin límite de tiempo. Y bajar de Pro a Gratis **nunca borra nada**: las
consultas grabadas, las transcripciones, las notas y las facturas quedan y se pueden seguir leyendo
y exportando.

El detalle técnico de cómo funciona el cobro está en [BILLING.md](BILLING.md).

---

## Cómo está organizada la app

La barra lateral parte el trabajo en dos modos, y el orden lo pidió el cliente:

| Grupo | Secciones |
|---|---|
| **Consultorio** — con el paciente delante | Athos · Modo Fantasma |
| **CRM** — entre consultas | Pacientes · Agenda · Ventas · Comunicaciones · Dashboard |
| **Se configura una vez** | Integraciones · Configuración · Ayuda |

Dos cosas que conviene saber antes de leer el resto:

- **La app abre en Athos**, no en el Dashboard. La idea es que lo primero que ves sea la
  conversación con el estado de la clínica al lado, y no una pantalla de métricas.
- **Titulares ya no es una sección aparte:** vive adentro de Pacientes, como una segunda vista. La
  relación sigue siendo un titular con varias mascotas.

---

## 1. Athos — el copiloto de la clínica  **(Pro)**

Athos es el asistente con el que se le habla a la clínica en lenguaje natural. Es la pantalla de
inicio, pero además flota sobre cualquier otra: se puede abrir en medio de una consulta o de la
agenda, y sabe qué pantalla tenés delante en ese momento.

**Saber qué está pasando en la clínica**

- El usuario puede ver, al lado de la conversación, un riel con **la clínica de hoy**: las citas del
  día, lo que está pendiente y la plata por cobrar, sin abrir otra pantalla.
- El usuario puede leer un **resumen diario redactado** de cómo viene el día, escrito una vez por
  jornada. **(Pro)** — las señales de abajo se calculan sin IA y no dependen del plan; lo que es de
  Pro es el párrafo escrito.
- El usuario puede ver qué está esperando a alguien, ordenado por urgencia real: primero un canal
  caído, después los titulares que escribieron y nadie respondió, después la cobranza escalada, las
  notas sin aprobar, los cobros vencidos y los refuerzos de vacuna por vencer.
- El usuario puede enterarse de que **WhatsApp se cayó** en vez de descubrirlo cuando un mensaje no
  sale.
- El usuario puede ver todo esto también desde el teléfono, en una tira compacta arriba de la
  conversación.

**Preguntar y consultar**

- El usuario puede hacerle preguntas clínicas y recibir una respuesta con la literatura veterinaria
  citada, para poder ir a la fuente y verificarla.
- El usuario puede saber **cuándo la literatura no alcanza**: Athos avisa antes de responder si lo
  que encontró no cubre bien el cuadro, en vez de responder con la misma seguridad siempre.
- El usuario puede preguntar por un paciente ("¿qué le pasó a Luna la última vez?") y Athos busca la
  ficha, el historial y las notas de consultas anteriores.
- El usuario puede preguntar por un titular a partir de su número de teléfono, sin recordar el nombre.
- El usuario puede preguntar qué alergias y qué medicación activa tiene un paciente antes de recetar.
- El usuario puede pedirle que busque en consultas pasadas ("¿cuándo fue la última vacunación?") y
  que le abra el detalle de una consulta concreta.

**Consultar la agenda**

- El usuario puede preguntar qué citas hay un día determinado.
- El usuario puede preguntar cuáles son los horarios de atención de la clínica.
- El usuario puede pedirle que le diga qué cupos quedan libres, calculados sobre los horarios reales.
- El usuario puede aprovechar un hueco de la agenda: desde el riel, pedirle a Athos a quién le
  vendría bien ese rato libre y qué escribirle para ofrecérselo.

**Leer las comunicaciones**

- El usuario puede pedirle que busque qué se habló con un titular por WhatsApp.
- El usuario puede pedirle que busque en su correo y que le lea un hilo completo, para ponerse al día
  sin salir de la app.

**Pedirle que haga cosas (siempre con aprobación)**

- El usuario puede pedirle que agende una cita, que la reprograme o que la modifique.
- El usuario puede pedirle que dé de alta un titular nuevo, una mascota nueva, o los dos a la vez.
- El usuario puede pedirle que actualice la ficha de un paciente.
- El usuario puede pedirle que le mande un WhatsApp a un titular.
- El usuario puede pedirle que escriba un correo nuevo o que responda uno existente, desde su propia
  cuenta de correo.
- El usuario puede pedirle que lo ponga al día con los cobros vencidos: a quién escribirle y qué
  decirle.
- El usuario puede **ver los pasos antes de aprobar**: la tarjeta de la propuesta desglosa todo lo
  que va a pasar ("crear la cita" + "copiarla al calendario"), no un botón a ciegas.
- El usuario puede **ver qué pasó de verdad después**: los pasos que salieron y los que no. Si el
  calendario no estaba conectado, ese paso aparece como no hecho en lugar de darse por bueno.
- **Nada de lo anterior se ejecuta solo:** Athos propone y el usuario aprueba o rechaza antes de que
  pase nada. Los mensajes que salen hacia afuera son siempre lo último que se confirma.

**Continuidad y control**

- El usuario puede volver a una conversación anterior con Athos y seguir donde la dejó.
- El usuario puede seguir hablando con Athos desde cualquier pantalla sin perder el hilo.
- El usuario puede ver **cuánto cupo de IA le queda** cuando su clínica tiene un tope: cuántas
  consultas restan y cuándo se reinicia. Se avisa antes de topárselo, no cuando ya se acabó.

---

## 2. Modo Fantasma — la consulta que se escribe sola  **(Pro)**

Es la grabación de la consulta y su conversión en nota clínica. El objetivo es que el veterinario
atienda mirando al animal y no a la pantalla.

**Grabar**

- El usuario puede iniciar la consulta y que **empiece a grabar de verdad** desde ese mismo momento.
- El usuario puede grabar desde el navegador, sin instalar nada ni usar otro dispositivo.
- El usuario puede pedirle el consentimiento al titular antes de grabar, como paso obligatorio.
- El usuario puede irse a otra pantalla de la app durante la consulta sin que la grabación se corte.

**Escribir mientras atiende**

- El usuario puede escribir en un **cuaderno** durante la consulta: lo que observa, lo que le dice el
  titular, lo que no quiere olvidar.
- El usuario puede confiar en que el cuaderno se guarda solo mientras escribe.
- El usuario puede escribir en el cuaderno tanto desde la pantalla de la consulta como desde el panel
  flotante, y ver siempre el mismo texto en los dos lados.
- El usuario puede tener **el transcripto y el cuaderno lado a lado**, sin saltar entre pantallas.

**La nota**

- El usuario puede obtener la transcripción de la consulta con las voces separadas (quién dijo qué).
- El usuario puede obtener una nota SOAP redactada automáticamente a partir de esa transcripción.
- El usuario puede ver **cuánta literatura respalda realmente la nota** — suficiente, limitada o
  ninguna — en lugar de un rótulo optimista que no corresponde con lo que se encontró.
- El usuario puede ver la **contraindicación por alergia marcada en rojo dentro del texto del plan**,
  con el fármaco nombrado, justo donde se decide prescribir.
- El usuario puede confiar en que una alergia severa **bloquea la aprobación** de la nota hasta que
  la revise.
- El usuario puede revisar, corregir y aprobar la nota antes de que quede en la historia clínica —
  nada entra a la ficha sin que un veterinario lo apruebe.
- El usuario puede confiar en que, una vez aprobada, la nota queda firmada con quién la aprobó y
  cuándo, y ya no se puede alterar.

**Después**

- El usuario puede volver a escuchar el audio de la consulta desde la ficha.
- El usuario puede borrar la transcripción y quedarse solo con el audio, o al revés.
- El usuario puede confiar en que el audio se borra solo a los pocos días, sin tener que acordarse.
- El usuario puede ver el listado de todas sus consultas y filtrarlo por estado de la nota
  (borrador, aprobada, sin nota) y por fecha.
- El usuario puede buscar una consulta por el nombre del paciente.
- El usuario puede saber de un vistazo cuántas notas tiene pendientes de revisar.

---

## 3. Pacientes y titulares — la ficha clínica

Una sola entrada en el menú, con dos vistas adentro: **Pacientes** y **Titulares**.

**Pacientes**

- El usuario puede ver el listado completo de pacientes de la clínica y buscar por nombre.
- El usuario puede crear un paciente nuevo desde cualquier pantalla, sin perder lo que estaba
  haciendo.
- El usuario puede **corregir la ficha de un paciente** después de crearlo: nombre, especie, raza,
  sexo, fecha de nacimiento, peso.
- El usuario puede abrir la ficha y ver toda su historia clínica en un solo lugar.
- El usuario puede registrar las alergias indicando la severidad, para que aparezcan como advertencia
  en el plan clínico.
- El usuario puede registrar la medicación, distinguiendo la crónica de la de un tratamiento puntual.
- El usuario puede registrar las vacunas con su lote, su dosis y la fecha de la próxima aplicación —
  y que los refuerzos por vencer le aparezcan solos como pendiente.
- El usuario puede adjuntar archivos a la ficha (exámenes, radiografías, fotos).
- El usuario puede marcar a un paciente como fallecido, sin perder su historia.
- El usuario puede **importar toda su base de pacientes desde un archivo CSV** al empezar, en vez de
  cargarlos uno por uno. **(admin)**

**Titulares**

- El usuario puede cambiar a la vista de Titulares con un clic, sin salir de la sección.
- El usuario puede **abrir la ficha de un titular** y ver sus datos completos: documento, teléfono,
  correo, dirección y notas.
- El usuario puede ver todas las mascotas de ese titular desde su ficha, y saltar a cualquiera.
- El usuario puede ver y **revocar el consentimiento de grabación** del titular, que cubre a todas
  sus mascotas de una vez.
- El usuario puede encontrar a un titular aunque todavía no tenga mascota cargada, o aunque la suya
  haya fallecido.

**Trazabilidad**

- El usuario puede saber **quién editó un paciente** y cuándo, en vez de que los cambios sean
  anónimos.
- El usuario puede saber **quién canceló una cita**.

---

## 4. Agenda

- El usuario puede ver el calendario de la clínica por mes, por semana o por día.
- El usuario puede crear una cita, editarla, moverla arrastrándola a otro horario y cancelarla.
- El usuario puede ver las próximas citas de la clínica sin abrir el calendario completo.
- El usuario puede definir los horarios de atención de la clínica, día por día, incluyendo cuánto
  dura cada cupo. **(admin)**
- El usuario puede ver qué cupos quedan realmente libres, calculados sobre esos horarios y las citas
  ya tomadas.
- El usuario puede conectar el calendario de la clínica con **Google Calendar** o con **Outlook**,
  para que las citas aparezcan también ahí. **(admin)**
- El usuario puede conseguir que, al agendar, al titular y al veterinario asignado les llegue la
  invitación por correo como cualquier otra reunión.
- El usuario puede suscribir cualquier otro calendario a la agenda de la clínica en modo solo
  lectura, mediante un enlace.
- El usuario puede saber quién canceló una cita.

> Tuvetia solo **escribe** en el calendario conectado; nunca lee los eventos personales de nadie.

---

## 5. Ventas — facturación, inventario y cobranza

Es el módulo de la parte administrativa. Se activa a voluntad: la clínica que no factura desde
Tuvetia no lo ve.

**Facturar**

- El usuario puede emitir una factura desde cero.
- El usuario puede facturar directamente una consulta que quedó sin facturar, sin volver a escribir
  los datos.
- El usuario puede ver qué consultas quedaron sin facturar y cuántas facturas emitidas están sin
  enviar.
- El usuario puede ver, imprimir y descargar cualquier factura.
- El usuario puede enviarle la factura al cliente por correo.
- El usuario puede darle al cliente un enlace público para ver su factura sin necesidad de tener
  cuenta en Tuvetia.
- El usuario puede cumplir con la numeración y las reglas de la **DIAN**. **(admin)**
- El usuario puede configurar los datos fiscales de su clínica. **(admin)**
- El usuario puede saber quién creó cada factura.

**Catálogo, inventario y compras**

- El usuario puede armar un catálogo de servicios y productos con sus precios, para no tipear lo
  mismo en cada factura. **(admin)**
- El usuario puede arrancar con **servicios sugeridos** desde el asistente de bienvenida, en vez de
  con el catálogo vacío. **(admin)**
- El usuario puede llevar el inventario con su stock y ver el historial de movimientos. **(admin)**
- El usuario puede registrar compras y órdenes a sus proveedores, y llevar la lista de
  proveedores. **(admin)**
- El usuario puede registrar los gastos de la clínica. **(admin)**
- El usuario puede cargar una receta sacándole una foto o pegando el texto, y que se convierta en
  ítems de la factura sin transcribirla a mano. **(Pro)**

**Cobrar**

- El usuario puede registrar pagos y abonos parciales sobre una factura. **(admin)**
- El usuario puede confiar en que un pago que el cliente ya entregó no se pierde al reemitir o
  corregir la factura.
- El usuario puede ver cuánta plata tiene por cobrar y desde hace cuánto, ordenado por antigüedad de
  la deuda. **(admin)**
- El usuario puede consultar la cartera **desde el teléfono**, desplazando la tabla. **(admin)**
- El usuario puede programar recordatorios de pago que salgan solos por WhatsApp y por
  correo. **(admin)**
- El usuario puede confiar en que esos recordatorios respetan los horarios y la frecuencia que exige
  la **Ley 2300**, sin tener que vigilarlo.
- El usuario puede ver las respuestas de los clientes ya clasificadas (va a pagar, discute el monto,
  pide plazo) en lugar de leerlas una por una. **(admin)** **(Pro)** — en el plan gratis las
  respuestas llegan igual, pero las lee una persona en vez de clasificarse solas.
- El usuario puede recibir un aviso cuando un caso necesita que intervenga una persona —por ejemplo,
  cuando el cliente manda un comprobante de pago. **(admin)**
- El usuario puede disparar la revisión de cobranza a mano cuando quiere, sin esperar al barrido
  diario. **(admin)**
- El usuario puede ver los casos de cobranza escalados como pendiente en el riel de Athos.

**Reportes**

- El usuario puede ver cómo va el mes: facturado, cobrado, pendiente. **(admin)**
- El usuario puede ver el reporte de finanzas de la clínica. **(admin)**

---

## 6. Comunicaciones

**WhatsApp**

- El usuario puede ver todas las conversaciones de WhatsApp de la clínica en una bandeja, agrupadas
  por titular.
- El usuario puede escribir y responder desde la app, sin sacar el teléfono.
- El usuario puede ver los mensajes nuevos entrar en vivo, sin recargar.
- El usuario puede recibir audios, imágenes y documentos que le mandan los titulares.
- El usuario puede ver el historial completo de lo que se habló con cada titular, aunque lo haya
  atendido otro compañero.
- El usuario puede saber **qué titulares escribieron y todavía no recibieron respuesta**, y desde
  cuándo espera el más antiguo.
- El usuario puede enterarse de que **el canal se cayó** —y desde cuándo— en vez de descubrirlo
  cuando un mensaje no llega.
- El usuario puede pedirle a **Athos que le sugiera la respuesta**, y enviarla, corregirla o
  descartarla. **(Pro)**
- El usuario puede activar el **modo automático**, en el que Athos responde solo las preguntas
  operativas (horarios, ubicación, cómo agendar) sin tocar nunca nada clínico. **(admin)** **(Pro)**
- El usuario puede desactivar el modo automático o tomar el control de una conversación en
  cualquier momento. **(admin)**

**Correo**

- El usuario puede ver su bandeja de correo dentro de Tuvetia, con la información del paciente al lado.
- El usuario puede responder correos desde la app.
- El usuario puede pedirle a Athos que busque, lea o redacte correos por él. **(Pro)**

---

## 7. Dashboard

Es la pantalla de "cómo va la clínica". Dejó de ser la de inicio —ese lugar lo ocupa Athos— y quedó
como la superficie de lectura, para cuando se quiere el detalle y no el resumen.

- El usuario puede ver cuántas consultas lleva la clínica este mes.
- El usuario puede ver cuántos pacientes tiene registrados.
- El usuario puede ver cuántas citas hay en los próximos 7 días.
- El usuario puede ver cuántas notas del Modo Fantasma están pendientes de revisar, para saber qué
  le falta cerrar.
- El usuario puede ver la evolución de las consultas de las últimas 12 semanas en un gráfico.
- El usuario puede ver la lista de las próximas citas y saltar directo a cualquiera.
- El usuario puede darse cuenta cuando una métrica **no se pudo cargar**, en vez de leer un cero y
  creer que la clínica está en cero.
- El usuario puede ver, mientras la clínica está a medio configurar, un riel que le dice exactamente
  qué le falta: el logo, los horarios, el primer paciente, los servicios del catálogo, WhatsApp y el
  equipo. El riel se retira solo cuando está todo listo. **(admin)**
- El usuario puede ver ese mismo progreso desde la barra lateral, esté en la pantalla que esté.
- El usuario puede borrar los datos de ejemplo con los que arrancó la cuenta, de un clic. **(admin)**

---

## 8. Integraciones

Es donde la clínica se conecta con el mundo de afuera. Antes se llamaba «Conexiones» y estaba pegada
a «Comunicaciones»; se separó y se renombró porque son cosas distintas: una es la bandeja donde
llegan los mensajes, esta es donde se enchufan los canales.

- El usuario puede conectar el WhatsApp de su clínica escaneando un QR, usando su propio número y
  sin entregarle credenciales a nadie. **(admin)**
- El usuario puede seguir usando su teléfono como siempre: las conversaciones llegan a los dos lados.
- El usuario puede conectar **su cuenta personal de correo** (Gmail u Outlook) para que Athos escriba
  por él. Cada miembro conecta la suya; Athos nunca escribe desde la cuenta de otro.
- El usuario puede desconectar su correo cuando quiera.
- El usuario puede conectar el calendario de la clínica —Google u Outlook— para que las citas se
  creen ahí. **(admin)**
- El usuario puede ver **desde la barra lateral, con un punto de color**, qué está conectado y qué no,
  sin entrar a la sección.
- El usuario puede ver qué consecuencia tiene que algo esté sin conectar (por ejemplo: "sin
  calendario conectado, nadie recibe invitación").
- El usuario puede recibir un aviso si el dominio de su correo no está bien configurado y sus
  mensajes corren riesgo de caer en spam.

> Tuvetia nunca ve la contraseña del correo ni del calendario: la autorización la maneja el
> proveedor.

---

## 9. Configuración

**La clínica y el equipo**

- El usuario puede ver los datos de su clínica y su propio rol.
- El usuario puede ver su rol en el pie de la barra lateral, siempre a la vista.
- El usuario puede subir el logo de la clínica, que después sale en las facturas. **(admin)**
- El usuario puede definir los horarios de atención. **(admin)**
- El usuario puede invitar colegas por un enlace o mandándoles la invitación por correo. **(admin)**
- El usuario puede asignarles rol de administrador o de veterinario. **(admin)**
- El usuario puede quitar a un miembro del equipo. **(admin)**
- El usuario puede ver qué invitaciones están pendientes. **(admin)**
- El usuario puede pertenecer a **varias clínicas** y cambiar de una a otra sin cerrar sesión.

**La cuenta**

- El usuario puede editar su nombre y su perfil.
- El usuario puede entrar con contraseña o con un enlace mágico al correo, sin recordar contraseñas.
- El usuario puede aceptar una invitación y quedar dentro de la clínica que lo invitó.
- El usuario puede entender qué pasó si su cuenta fue desactivada: una pantalla se lo dice y le
  aclara que **sus datos siguen ahí**, en vez de tratarlo como alguien sin clínica.

**El plan**

- El usuario puede abrir **Plan** desde el menú de su perfil y ver en qué plan está su clínica y qué
  incluye cada uno.
- El usuario puede **contratar Pro** con tarjeta, sin salir de la app. **(admin)**
- El usuario puede ver qué tarjeta quedó registrada, cuándo se renueva y el historial de pagos.
- El usuario puede **cambiar la tarjeta** cuando vence o cuando quiere usar otra. **(admin)**
- El usuario puede **cancelar cuando quiera**, y seguir usando Pro hasta que termine el mes que ya
  pagó. **(admin)**
- El usuario puede enterarse de que un cobro falló y de cuándo se va a reintentar, con varios días
  de margen antes de perder el acceso.
- El usuario puede confiar en que bajar de plan **no borra nada**: sus consultas, notas y facturas
  siguen ahí y se pueden exportar.
- El usuario puede saber que Tuvetia **nunca ve los datos de su tarjeta**: van directo a la pasarela
  de pagos.

**Sus datos**

- El usuario puede **descargar todo**: pacientes, titulares, consultas, transcripciones, notas,
  citas y mensajes, en un archivo abierto y en cualquier momento. Sus datos son suyos y se puede ir
  cuando quiera.
- El usuario puede confiar en que los datos de su clínica están aislados de los de cualquier otra.
- El usuario puede saber que las grabaciones tienen consentimiento y se purgan solas, como exige la
  ley de datos personales.
- El usuario puede saber quién tocó qué: las ediciones y los borrados quedan registrados con autor.

**Empezar bien**

- El usuario puede pasar por un **asistente de bienvenida de 6 pasos**: clínica → horarios →
  servicios → primer paciente → datos de ejemplo → equipo.
- El usuario puede **aceptar los horarios sugeridos** (lunes a viernes 8–18, sábado 8–12) en vez de
  escribirlos, y corregirlos después desde la agenda.
- El usuario puede **partir de un catálogo de servicios sugerido**, con nombres y duraciones, y
  ponerle los precios él.
- El usuario puede saltarse cualquier paso salvo el primero, y volver después sin que se le duplique
  nada de lo ya cargado.
- El usuario puede tener a Athos al lado durante el onboarding, y si Athos falla el wizard sigue
  funcionando igual.

**Cuando algo se rompe**

- El usuario puede ver una pantalla de error que le explica qué hacer, en vez de una página en blanco.

**Ayuda**

- El usuario puede hacer un tour guiado por la app la primera vez.
- El usuario puede repetir el onboarding cuando quiera.
- El usuario puede consultar la ayuda contextual —los signos de pregunta— sin salir de donde está.
- El usuario puede abrir la página de ayuda desde la barra lateral.

---

## Todavía no disponible

Cosas que están construidas pero apagadas, o que aún no existen. Se listan para que nadie las
prometa antes de tiempo.

- **Importar el inventario desde Excel.** Sigue deshabilitado por un problema de seguridad de la
  librería que lee el archivo. La pantalla lo dice; el inventario se carga a mano mientras tanto.
- **Los correos salientes.** El envío de facturas por correo, los recordatorios de cobranza y las
  invitaciones por correo están construidos, pero falta la credencial del servicio de envío. El
  enlace de invitación sí funciona.
- **Términos y política de privacidad.** Las páginas existen y dicen honestamente "documento en
  preparación", pero no tienen contenido definitivo.
- **El medidor de consumo, encendido.** El medidor de cupo de IA está construido y probado, pero hoy
  **no se muestra**: los planes ya existen, pero ninguno tiene todavía un tope de uso definido. En
  cuanto se fije uno, se enciende solo.
- **Que se le cobre a las clínicas que ya existen.** El cobro funciona —está probado de punta a
  punta con dinero real— pero las clínicas que ya venían usando Tuvetia siguen con **Pro de
  cortesía**: nadie perdió Athos ni el Modo Fantasma de un día para el otro. Pasarlas al plan pago
  es una decisión comercial, con aviso previo, no un efecto automático.
- **Factura de la suscripción.** Tuvetia no emite todavía una factura por el plan Pro. El módulo de
  Ventas le factura a los *clientes de la clínica*, no a la clínica.
- **Avisos de pago por correo.** Que un cobro se aprobó o falló solo se ve dentro de la app; no sale
  ningún correo. Depende de la misma credencial de envío que falta arriba. Mientras tanto, quien
  entre a **Plan** sí ve el estado, la tarjeta registrada, el próximo cobro y el historial.
- **Cambiar de plan a mitad de mes.** Hay alta, renovación y cancelación al final del período. No hay
  prorrateo.
- **El período de prueba.** Se menciona un trial de 3 días, pero no existe ningún reloj que lo
  aplique. Con un plan gratis de por vida, un trial de Pro es otra cosa distinta y todavía no se
  definió.
