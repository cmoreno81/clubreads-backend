Club Lectura Backend - Database Design v1.0
# 📚 Club Lectura Backend
## Database Design v1.0

---

# Objetivo

Este documento define el modelo de datos del backend de Club Lectura.

La filosofía del proyecto es que cada dato exista una única vez y que todas las funcionalidades de la aplicación se construyan a partir de relaciones entre entidades.

La base de datos será PostgreSQL y el acceso a los datos se realizará mediante Prisma ORM.

---

# Principios de diseño

## 1. Una única fuente de verdad

Cada entidad existe una única vez.

Ejemplos:

- Un libro solo existe una vez.
- Una usuaria solo existe una vez.
- Una lectura pertenece a un único libro.

Nunca se duplican datos.

---

## 2. Las relaciones contienen el contexto

Un libro no sabe quién lo está leyendo.

Es la relación entre Usuario y Libro la que almacena:

- estado
- prioridad
- valoración
- reseña
- fechas

---

## 3. El Dashboard nunca almacena datos

Todas las estadísticas se calculan en tiempo real mediante consultas SQL.

No existe ninguna tabla Dashboard.

---

## 4. Soft Delete

Ninguna entidad importante se elimina físicamente.

Todas disponen del campo:

deletedAt

Esto permite recuperar información y mantener el historial.

---

# Modelo de dominio

El sistema se divide en los siguientes módulos.

👤 Usuarios

📚 Catálogo de libros

📖 Biblioteca personal

📖 Lecturas compartidas

💬 Conversaciones

❤️ Likes

🏆 Clubvisión

📊 Estadísticas

---

# ENTIDADES

# User

Representa una lectora del club.

Existe una única vez.

Responsabilidades:

- iniciar sesión
- mantener su biblioteca
- comentar
- responder
- votar
- valorar libros

Campos

id

name

email

avatar

active

createdAt

updatedAt

deletedAt

Relaciones

User

↓

UserBook

↓

Comment

↓

Reply

↓

Vote

# Book

Representa una obra literaria.

Cada libro existe una única vez independientemente del número de lectoras.

Información almacenada

id

title

author

genre

series

seriesNumber

standalone

goodreadsUrl

isbn

coverUrl

synopsis

createdBy

createdAt

updatedAt

deletedAt

## Ejemplo

Incorrecto

Ana
Harry Potter

Cristina
Harry Potter

Laura
Harry Potter

Correcto

Book

Harry Potter

UserBook

Ana -> Harry Potter

Cristina -> Harry Potter

Laura -> Harry Potter

# UserBook

Representa la relación entre una lectora y un libro.

No representa un libro.

Representa la experiencia personal de una usuaria con ese libro.

Contiene toda la información específica de esa lectura.

Campos

id

userId

bookId

status

priority

rating

review

startedAt

finishedAt

createdAt

updatedAt

deletedAt

## Prioridad

La prioridad representa las ganas que tiene una lectora de comenzar un libro.

No tiene relación con la valoración.

Valores posibles

LOW

MEDIUM

HIGH

## Valoración

La valoración representa la opinión de la lectora una vez finalizado el libro.

Escala

0 = Abandonado

1

2

3

4

5

# Reading

Representa una lectura compartida organizada por el club.

Siempre pertenece a un único libro.

Un mismo libro puede tener varias lecturas a lo largo de la historia del club.

Responsabilidad

Organizar la conversación de una lectura concreta.

Campos

id

bookId

type

status

chapters

hasPrologue

hasEpilogue

startedAt

finishedAt

createdAt

updatedAt

deletedAt

NOT_CONFIGURED

ACTIVE

FINISHED

FREE

CLUB

# ReadingParticipant

Representa la participación de una usuaria en una lectura.

Campos

id

readingId

userId

joinedAt

leftAt

¿Quién empezó leyendo este libro?

¿Quién se incorporó a mitad?

¿Cuántas personas terminaron?

¿Cuánto tiempo estuvo cada una?

Capítulo 1

Capítulo 2

Epílogo

Reflexión final

# Conversation

Representa un espacio de conversación dentro de una lectura.

No representa únicamente capítulos.

Puede representar cualquier momento de conversación.

Campos

id

readingId

title

order

type

createdAt

updatedAt

deletedAt

PROLOGUE

CHAPTER

EPILOGUE

FINAL_REFLECTION

AUTHOR_INTERVIEW

THEORIES

CHARACTERS

ENDING

EXTRAS

# Comment

Representa un comentario publicado dentro de una conversación.

Campos

id

conversationId

userId

text

createdAt

updatedAt

deletedAt

# Reply

Representa una respuesta a un comentario.

Campos

id

commentId

userId

text

replyToReplyId

createdAt

updatedAt

deletedAt

# Likes

CommentLike

Usuario

Comentario

# Relaciones 

Book

↓

Reading

↓

Conversation

↓

Comment

↓

Reply

↓

Like

# Edition

Representa una edición mensual de Clubvisión.

Cada edición tiene un conjunto de candidatas, un periodo de votación y un libro ganador.

Responsabilidad

Gestionar el ciclo completo de una edición de Clubvisión.

Campos

id

month

year

status

winnerBookId

createdAt

updatedAt

closedAt

EditionStatus

PREPARING

VOTING

RESULTS

READING

FINISHED

# Candidate

Representa un libro participante en una edición.

Campos

id

editionId

bookId

createdAt

# Vote

Representa la puntuación otorgada por una usuaria a un libro.

Campos

id

editionId

userId

bookId

points

createdAt

# Relaciones

Edition

↓

Candidate

↓

Book

Edition

↓

Vote

↓

User

# Estructura final

User
│
├── Library
│      │
│      └── Book
│
├── Comment
│
├── Reply
│
├── Vote
│
└── Notification


Book
│
├── Reading
│       │
│       ├── Conversation
│       │        │
│       │        ├── Comment
│       │        │       │
│       │        │       └── Reply
│       │        │
│       │        └── Like
│       │
│       └── Participants
│
└── Candidate


Edition
│
├── Candidate
│
└── Vote



## Evolución futura

El diseño permite añadir nuevos tipos de conversación sin modificar la estructura de la base de datos.

Ejemplos

- Entrevistas con autores
- Teorías
- Debate final
- Preguntas frecuentes
- Material adicional
- Clubes privados

