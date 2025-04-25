import { useState, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

// Form validation schema
const formSchema = z.object({
  name: z.string().min(1, "Batch name is required"),
  description: z.string().optional(),
});

// Type for form data
type FormData = z.infer<typeof formSchema>;

interface EditBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: {
    id: number;
    name: string;
    description?: string;
  };
}

export default function EditBatchModal({ isOpen, onClose, batch }: EditBatchModalProps) {
  const { toast } = useToast();
  
  // Form setup with proper default values that update when the batch changes
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: batch.name,
      description: batch.description || "", 
    },
  });
  
  // Reset form values when batch changes or modal opens
  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: batch.name,
        description: batch.description || "",
      });
    }
  }, [batch, isOpen, form]);
  
  // Edit batch mutation
  const { mutate, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest(
        "PATCH", 
        `/api/document-batches/${batch.id}`, 
        data
      );
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate the relevant queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/document-batches'] });
      queryClient.invalidateQueries({ queryKey: ['batchDetails', batch.id] });
      
      toast({
        title: "Batch updated",
        description: "Batch details have been updated successfully.",
      });
      
      // Close the modal
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating batch",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  function onSubmit(data: FormData) {
    mutate(data);
  }
  
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Batch</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter batch name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Enter batch description (optional)" 
                      className="resize-none" 
                      {...field} 
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}