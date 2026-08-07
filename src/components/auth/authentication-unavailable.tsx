import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function AuthenticationUnavailable() {
  return (
    <Card className="w-full">
      <CardHeader className="space-y-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold">
            Account sign-in is not configured
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This environment has no Clerk authentication credentials. It will
            not simulate a real account or accept a local password.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
        <p>
          Anonymous practice remains available only when the pilot is enabled,
          and its progress cannot follow you to another device until you sign in
          through a configured environment.
        </p>
        <p className="text-center">
          <Link className="underline underline-offset-4" href="/">
            Return home
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
