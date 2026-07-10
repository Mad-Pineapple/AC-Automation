import { useListBrands } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Palette, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMe } from "@/hooks/use-me";

export default function BrandList() {
  const { data: brands, isLoading } = useListBrands();
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight font-sans">Brands</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">Brand Guidelines & Profiles</p>
        </div>
        {isAdmin && (
          <Link href="/brands/new">
            <Button data-testid="button-new-brand" className="font-mono uppercase text-xs tracking-wider">
              <Plus className="w-4 h-4 mr-2" />
              New Brand
            </Button>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : brands?.length === 0 ? (
        <Card className="border-dashed bg-transparent p-12 text-center">
          <Palette className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No brands found</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {isAdmin ? "Create your first brand profile to start generating assets." : "No brands have been set up yet."}
          </p>
          {isAdmin && (
            <Link href="/brands/new">
              <Button variant="outline">Create Brand</Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {brands?.map(brand => (
            <Link key={brand.id} href={`/brands/${brand.id}`}>
              <Card className="hover:border-primary transition-colors cursor-pointer group h-full flex flex-col overflow-hidden">
                <div 
                  className="h-24 w-full relative" 
                  style={{ backgroundColor: brand.backgroundColor || '#f0f0f0' }}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    {brand.logoUrl ? (
                      <img src={brand.logoUrl} alt={brand.name} className="h-12 object-contain" />
                    ) : (
                      <span className="text-2xl font-bold" style={{ color: brand.textColor || '#000' }}>
                        {brand.name}
                      </span>
                    )}
                  </div>
                </div>
                <CardHeader className="flex-1 pb-4">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-xl group-hover:text-primary transition-colors">{brand.name}</CardTitle>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0" />
                  </div>
                  {brand.industry && (
                    <Badge variant="secondary" className="mt-2 text-xs font-normal">{brand.industry}</Badge>
                  )}
                </CardHeader>
                <CardContent className="pt-0 flex gap-2">
                  <div className="w-6 h-6 rounded-full border border-border shadow-sm" style={{ backgroundColor: brand.primaryColor }} title="Primary" />
                  <div className="w-6 h-6 rounded-full border border-border shadow-sm" style={{ backgroundColor: brand.secondaryColor }} title="Secondary" />
                  <div className="w-6 h-6 rounded-full border border-border shadow-sm" style={{ backgroundColor: brand.accentColor }} title="Accent" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
