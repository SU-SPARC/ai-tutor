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

export default function TopicNotFound() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SearchX className="h-5 w-5 text-primary" />
              Topic not found
            </CardTitle>
            <CardDescription>
              We could not find that topic. It may have been renamed or is not
              available yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/topics">Browse topics</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
