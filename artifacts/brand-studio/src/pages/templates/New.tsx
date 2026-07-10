import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateTemplate, getListTemplatesQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useMe } from "@/hooks/use-me";
import { ChevronLeft } from "lucide-react";
import { TemplateForm, TemplateFormValues, TEMPLATE_FORM_DEFAULTS } from "@/components/TemplateForm";

export default function NewTemplate() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meData, isLoading: isLoadingMe } = useMe();
  const isAdmin = meData?.role === "admin";
  const createTemplate = useCreateTemplate();

  useEffect(() => {
    if (!isLoadingMe && !isAdmin) {
      toast({ title: "You don't have permission to create templates", variant: "destructive" });
      setLocation("/templates");
    }
  }, [isLoadingMe, isAdmin, setLocation, toast]);

  if (isLoadingMe || !isAdmin) {
    return null;
  }

  const onSubmit = (values: TemplateFormValues) => {
    createTemplate.mutate({
      data: {
        name: values.name,
        description: values.description || null,
        category: values.category,
        width: values.width,
        height: values.height,
        config: {
          contentAlignment: values.contentAlignment,
          textAlign: values.textAlign,
          showAccentBar: values.showAccentBar,
          showLogoBar: values.showLogoBar,
          imageStyle: values.imageStyle,
        },
      },
    }, {
      onSuccess: () => {
        toast({ title: "Template created" });
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        setLocation("/templates");
      },
      onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/templates" className="p-2 hover:bg-muted rounded-full transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Template</h1>
          <p className="text-muted-foreground text-sm font-mono mt-1 uppercase tracking-widest">Define A Creative Format</p>
        </div>
      </div>

      <TemplateForm
        defaultValues={TEMPLATE_FORM_DEFAULTS}
        onSubmit={onSubmit}
        submitting={createTemplate.isPending}
        submitLabel="Create Template"
      />
    </div>
  );
}
