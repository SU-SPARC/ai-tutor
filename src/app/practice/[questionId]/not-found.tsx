import Link from "next/link"
import { SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function PracticeQuestionNotFound() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SearchX className="h-5 w-5 text-primary" />
              Question not available
            </CardTitle>
            <CardDescription>
              This question could not be found, or it is not approved for
              students yet. Try picking another question from a topic.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/topics">Browse topics</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/practice">Open practice</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
