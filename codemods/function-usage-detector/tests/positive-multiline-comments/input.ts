export function multilineCommentShort(value: number) {
  const answer = value /* comment starts
  comment body
  comment ends */
  return answer
}

multilineCommentShort(1)
multilineCommentShort(2)
multilineCommentShort(3)
