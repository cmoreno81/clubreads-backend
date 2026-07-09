-- AlterTable
ALTER TABLE "Comment"
ADD COLUMN IF NOT EXISTS "parentId" TEXT;
-- Drop old tables
DROP TABLE IF EXISTS "CommentLike" CASCADE;
DROP TABLE IF EXISTS "CommentReply" CASCADE;
-- CreateTable
CREATE TABLE "Like" (
  "id" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Like_userId_idx" ON "Like"("userId");
-- CreateIndex
CREATE UNIQUE INDEX "Like_commentId_userId_key" ON "Like"("commentId", "userId");
-- CreateIndex
CREATE INDEX "Comment_conversationId_idx" ON "Comment"("conversationId");
-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");
-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");
-- AddForeignKey
ALTER TABLE "Like"
ADD CONSTRAINT "Like_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Like"
ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Comment"
ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE
SET NULL ON UPDATE CASCADE;