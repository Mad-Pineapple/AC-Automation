import { useCreateBrand, getListBrandsQueryKey } from "@workspace/api-client-react";
import { BrandForm } from "@/components/BrandForm";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft } from "lucide-react";
import { Link } from "wouter";
import { useMe } from "@/hooks/use-me";
import { useEffect } from "react";

export default function NewBrand() {
  const [, setLocation] = useLocation();
  const createBrand = useCreateBrand();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";

  useEffect(() => {
    if (!isLoadingMe && !isAdmin) {
      toast({ title: "You don't have permission to create brands", variant: "destructive" });
      setLocation("/brands");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast]);

  if (isLoadingMe || !isAdmin) {
    return null;
  }

  const handleSubmit = (data: any) => {
    createBrand.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "Brand created successfully" });
        queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
        setLocation("/brands");
      },
      onError: (err) => {
        toast({ title: "Failed to create brand", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/brands" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Brand Profile</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">Configure brand identity and AI context</p>
        </div>
      </div>
      
      <BrandForm onSubmit={handleSubmit} isSubmitting={createBrand.isPending} />
    </div>
  );
}
