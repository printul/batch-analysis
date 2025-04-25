import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import Header from "@/components/header";
import Footer from "@/components/footer";
import TabNavigation from "@/components/tab-navigation";
import UsersList from "@/components/users-list";
import AddUserModal from "@/components/add-user-modal";
import DeleteConfirmModal from "@/components/delete-confirm-modal";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Form, 
  FormControl, 
  FormDescription, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, FilePlus, Upload, FolderOpen, Edit, Pencil } from "lucide-react";
import EditBatchModal from "@/components/edit-batch-modal";

export type User = {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
};

// Types for document batches and analysis
interface DocumentBatch {
  id: number;
  name: string;
  description: string;
  userId: number;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

interface Document {
  id: number;
  batchId: number;
  filename: string;
  fileType: string;
  filePath: string;
  extractedText: string;
  createdAt: string;
}

interface Analysis {
  id: number;
  batchId: number;
  summary: string;
  themes: string[];
  tickers?: string[];
  recommendations?: string[];
  sentimentScore: number;
  sentimentLabel: string;
  sentimentConfidence?: number;
  sharedIdeas?: string[];
  divergingIdeas?: string[];
  keyPoints: string[];
  createdAt: string;
}

// Direct array response from the API
type BatchesResponse = DocumentBatch[];

interface BatchDetailResponse {
  batch: DocumentBatch;
  documents: Document[];
  analysis?: Analysis;
}

// Document Upload Form Component
interface DocumentUploadFormProps {
  batchId: number | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function DocumentUploadForm({ batchId, onSuccess, onCancel }: DocumentUploadFormProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileList | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  
  if (!batchId) {
    return (
      <div className="text-center py-6">
        <p className="text-red-500 mb-4">No batch selected. Please select a batch first.</p>
        <Button onClick={onCancel}>Close</Button>
      </div>
    );
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(e.target.files);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!files || files.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one file to upload",
        variant: "destructive",
      });
      return;
    }
    
    setIsUploading(true);
    setCurrentFileIndex(0);
    setUploadProgress(0);
    
    try {
      // Upload files one by one to show progress
      for (let i = 0; i < files.length; i++) {
        setCurrentFileIndex(i);
        const file = files[i];
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('batchId', batchId.toString());
        
        const response = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to upload ${file.name}: ${errorText}`);
        }
        
        // Update progress
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      }
      
      // Invalidate the batch details query to refresh the documents list
      queryClient.invalidateQueries({ queryKey: ['/api/document-batches', batchId] });
      
      toast({
        title: "Upload Complete",
        description: `Successfully uploaded ${files.length} document${files.length !== 1 ? 's' : ''}`,
      });
      
      onSuccess();
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "An error occurred during upload",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-2">
        <Label htmlFor="document-file">Select Files</Label>
        <Input 
          id="document-file" 
          type="file" 
          multiple
          onChange={handleFileChange}
          className="file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:bg-primary/10 file:text-primary" 
        />
        <p className="text-xs text-gray-500">Supported formats: PDF, TXT, DOC, DOCX</p>
        
        {files && files.length > 0 && (
          <div className="mt-2">
            <p className="text-sm text-gray-700 mb-1">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
            <ul className="text-xs text-gray-500 list-disc pl-5 max-h-24 overflow-auto">
              {Array.from(files).map((file, index) => (
                <li key={index} className={isUploading && index === currentFileIndex ? "font-medium text-primary" : ""}>
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {isUploading && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Uploading {currentFileIndex + 1} of {files?.length}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary" 
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>
      
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isUploading}>
          Cancel
        </Button>
        <Button type="submit" disabled={isUploading || !files || files.length === 0}>
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            'Upload Files'
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Create Batch Form Component
const batchFormSchema = z.object({
  name: z.string().min(3, {
    message: "Batch name must be at least 3 characters.",
  }),
  description: z.string().optional(),
});

type BatchFormData = z.infer<typeof batchFormSchema>;

interface CreateBatchFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function CreateBatchForm({ onSuccess, onCancel }: CreateBatchFormProps) {
  const { toast } = useToast();
  
  const form = useForm<BatchFormData>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });
  
  const { mutate, isPending } = useMutation({
    mutationFn: async (data: BatchFormData) => {
      const response = await fetch('/api/document-batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create batch');
      }
      
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate batches query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/document-batches'] });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error creating batch",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  function onSubmit(data: BatchFormData) {
    mutate(data);
  }
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Batch Name</FormLabel>
              <FormControl>
                <Input placeholder="Q2 Financial Reports" {...field} />
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
                  placeholder="Quarterly financial reports and analysis for Q2 2025" 
                  {...field} 
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Batch
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState<'documents' | 'batches' | 'analysis' | 'admin'>('batches');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [isCreateBatchModalOpen, setIsCreateBatchModalOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [isUploadDocumentModalOpen, setIsUploadDocumentModalOpen] = useState(false);
  const [isEditBatchModalOpen, setIsEditBatchModalOpen] = useState(false);
  const [selectedBatchForEdit, setSelectedBatchForEdit] = useState<DocumentBatch | null>(null);
  
  // Use the auth context instead of direct query
  const { user, isLoading } = useAuth();
  
  // The ProtectedRoute component now handles redirects if not authenticated
  
  // Fetch document batches
  const { data: batchesData, isLoading: isBatchesLoading } = useQuery<BatchesResponse>({
    queryKey: ['/api/document-batches'],
  });
  
  // Handle user deletion
  const handleDeleteUser = (userId: number) => {
    setSelectedUserId(userId);
    setIsDeleteModalOpen(true);
  };
  
  // If loading, show loading indicator
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  // User is guaranteed to exist due to ProtectedRoute component
  if (!user) {
    return null;
  }
  
  const userData = user;
  const isAdmin = userData.isAdmin;
  
  // Document Batches UI
  const renderDocumentBatches = () => {
    if (isBatchesLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    
    const batches = batchesData || [];
    
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Document Batches</h1>
          <Button 
            onClick={() => setIsCreateBatchModalOpen(true)}
            className="flex items-center gap-2"
          >
            <FilePlus className="h-4 w-4" />
            Create Batch
          </Button>
        </div>
        
        {batches.length === 0 ? (
          <Card className="bg-gray-50 border-dashed">
            <CardContent className="pt-6 pb-6 flex flex-col items-center justify-center">
              <div className="rounded-full bg-primary/10 p-3 mb-3">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium mb-2">No document batches yet</h3>
              <p className="text-sm text-gray-500 text-center max-w-md mb-4">
                Create a batch to upload and analyze multiple documents together.
              </p>
              <Button
                onClick={() => setIsCreateBatchModalOpen(true)}
                variant="outline"
                className="mt-2"
              >
                Create your first batch
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {batches.map((batch: any) => (
              <Card key={batch.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>{batch.name}</CardTitle>
                      <CardDescription className="truncate">{batch.description}</CardDescription>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8" 
                      onClick={() => {
                        setSelectedBatchForEdit(batch);
                        setIsEditBatchModalOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-500">Created</span>
                    <span className="font-medium">{new Date(batch.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Documents</span>
                    <span className="font-medium">{batch.documentCount || 0}</span>
                  </div>
                </CardContent>
                <CardFooter className="flex gap-2 justify-end border-t pt-4">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setSelectedBatchId(batch.id);
                      setIsUploadDocumentModalOpen(true);
                    }}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </Button>
                  <div className="flex gap-2">
                    <Button 
                      size="sm"
                      onClick={() => {
                        setSelectedBatchId(batch.id);
                        setActiveTab('analysis');
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Analyze
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => {
                        setLocation(`/batch/${batch.id}`);
                      }}
                    >
                      Details
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };
  
  // Always fetch analysis data if we have a selectedBatchId
  const { 
    data: analysisData, 
    isLoading: isAnalysisLoading,
    error: analysisError
  } = useQuery<BatchDetailResponse>({
    queryKey: [`/api/document-batches/${selectedBatchId}`],
    // Only run the query if we have a selectedBatchId
    enabled: !!selectedBatchId,
    retry: 3,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    gcTime: 300000
  });
  
  // Document Analysis UI
  const renderDocumentAnalysis = () => {
    if (!selectedBatchId) {
      return (
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Select a Batch to Analyze</h2>
          <p className="text-gray-500 mb-6">Choose a document batch from the "Document Batches" tab</p>
          <Button onClick={() => setActiveTab('batches')}>Go to Batches</Button>
        </div>
      );
    }
    
    if (isAnalysisLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    
    const batch = analysisData?.batch;
    const documents = analysisData?.documents || [];
    const analysis = analysisData?.analysis;
    
    if (!batch) {
      return (
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Batch Not Found</h2>
          <p className="text-gray-500 mb-6">The selected batch could not be found</p>
          <Button onClick={() => setActiveTab('batches')}>Go to Batches</Button>
        </div>
      );
    }
    
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{batch.name}</h1>
            <p className="text-gray-500">{batch.description}</p>
          </div>
          {!analysis && documents.length > 0 && (
            <Button 
              onClick={() => {
                // Trigger analysis mutation
                (async () => {
                  try {
                    const response = await fetch(`/api/document-batches/${batch.id}/analyze`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      credentials: 'include',
                    });
                    
                    if (!response.ok) {
                      throw new Error('Failed to start analysis');
                    }
                    
                    toast({
                      title: "Analysis Started",
                      description: "Document analysis has been initiated and may take a few moments to complete.",
                    });
                    
                    // Invalidate batch query to refresh the data after a delay
                    setTimeout(() => {
                      queryClient.invalidateQueries({ queryKey: ['/api/document-batches', selectedBatchId] });
                    }, 5000);
                    
                  } catch (error) {
                    toast({
                      title: "Analysis Failed",
                      description: error instanceof Error ? error.message : "An error occurred during analysis",
                      variant: "destructive",
                    });
                  }
                })();
              }}
            >
              Analyze Documents
            </Button>
          )}
        </div>
        
        {documents.length === 0 ? (
          <Card className="bg-gray-50 border-dashed">
            <CardContent className="pt-6 pb-6 flex flex-col items-center justify-center">
              <div className="rounded-full bg-primary/10 p-3 mb-3">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium mb-2">No documents in this batch</h3>
              <p className="text-sm text-gray-500 text-center max-w-md mb-4">
                Upload documents to this batch before performing analysis.
              </p>
              <Button
                onClick={() => {
                  setIsUploadDocumentModalOpen(true);
                }}
                variant="outline"
                className="mt-2"
              >
                Upload documents
              </Button>
            </CardContent>
          </Card>
        ) : !analysis ? (
          <div>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Documents in this Batch</CardTitle>
                <CardDescription>The following documents are ready for analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {documents.map((doc: any) => (
                    <li key={doc.id} className="py-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium">{doc.filename}</p>
                        <p className="text-sm text-gray-500">Uploaded on {new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="outline">{doc.fileType.toUpperCase()}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            
            <div className="text-center py-6">
              <p className="text-gray-500 mb-4">This batch has not been analyzed yet</p>
              <Button 
                onClick={() => {
                  // Trigger analysis mutation
                  (async () => {
                    try {
                      const response = await fetch(`/api/document-batches/${batch.id}/analyze`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                      });
                      
                      if (!response.ok) {
                        throw new Error('Failed to start analysis');
                      }
                      
                      toast({
                        title: "Analysis Started",
                        description: "Document analysis has been initiated and may take a few moments to complete.",
                      });
                      
                      // Invalidate batch query to refresh the data after a delay
                      setTimeout(() => {
                        queryClient.invalidateQueries({ queryKey: [`/api/document-batches/${selectedBatchId}`] });
                      }, 5000);
                      
                    } catch (error) {
                      toast({
                        title: "Analysis Failed",
                        description: error instanceof Error ? error.message : "An error occurred during analysis",
                        variant: "destructive",
                      });
                    }
                  })();
                }}
              >
                Start Analysis
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="summary" className="space-y-4">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
              <TabsTrigger value="financial">Financial Data</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
            
            <TabsContent value="summary" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Document Analysis Summary</CardTitle>
                  <CardDescription>A comprehensive overview of the analyzed documents</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 mb-6">{analysis.summary}</p>
                  
                  <div className="mb-6">
                    <h3 className="text-sm font-medium mb-2">Key Points</h3>
                    <ul className="space-y-2">
                      {analysis.keyPoints.map((point: string, index: number) => (
                        <li key={index} className="flex">
                          <span className="mr-2 text-primary">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
                <CardFooter className="text-xs text-gray-500">
                  Analysis performed {new Date(analysis.createdAt).toLocaleDateString()} at {new Date(analysis.createdAt).toLocaleTimeString()}
                </CardFooter>
              </Card>
            </TabsContent>
            
            <TabsContent value="insights" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Themes & Ideas</CardTitle>
                  <CardDescription>Major themes and key ideas from the documents</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <h3 className="text-sm font-medium mb-2">Major Themes</h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.themes.map((theme: string, index: number) => (
                        <Badge key={index} variant="outline" className="px-3 py-1">
                          {theme}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <h3 className="text-sm font-medium mb-2">Shared Ideas</h3>
                    <ul className="space-y-2">
                      {analysis.sharedIdeas && analysis.sharedIdeas.length > 0 ? (
                        analysis.sharedIdeas.map((idea: string, index: number) => (
                          <li key={index} className="flex">
                            <span className="mr-2 text-green-500">✓</span>
                            <span>{idea}</span>
                          </li>
                        ))
                      ) : (
                        <p className="text-gray-500 text-sm">No shared ideas identified across documents</p>
                      )}
                    </ul>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-medium mb-2">Diverging Viewpoints</h3>
                    <ul className="space-y-2">
                      {analysis.divergingIdeas && analysis.divergingIdeas.length > 0 ? (
                        analysis.divergingIdeas.map((idea: string, index: number) => (
                          <li key={index} className="flex">
                            <span className="mr-2 text-orange-500">⟳</span>
                            <span>{idea}</span>
                          </li>
                        ))
                      ) : (
                        <p className="text-gray-500 text-sm">No diverging viewpoints identified across documents</p>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="financial" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Financial Analysis</CardTitle>
                  <CardDescription>Stock tickers and financial recommendations</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <h3 className="text-sm font-medium mb-2">Sentiment</h3>
                    <div className="flex items-center mb-2">
                      <div className="text-xl font-bold mr-3">{analysis.sentimentScore}/5</div>
                      <Badge 
                        className={`px-3 py-1 ${
                          analysis.sentimentLabel === 'positive' 
                            ? 'bg-green-100 text-green-800' 
                            : analysis.sentimentLabel === 'negative'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {analysis.sentimentLabel}
                      </Badge>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div 
                        className="bg-primary h-2.5 rounded-full" 
                        style={{ width: `${(analysis.sentimentScore / 5) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  
                  <div className="mb-6">
                    <h3 className="text-sm font-medium mb-2">Mentioned Tickers</h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.tickers && analysis.tickers.length > 0 ? (
                        analysis.tickers.map((ticker: string, index: number) => (
                          <Badge key={index} className="px-3 py-1 bg-primary/10 text-primary">
                            ${ticker}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-gray-500 text-sm">No stock tickers found in the documents</p>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-medium mb-2">Recommendations</h3>
                    <ul className="space-y-2">
                      {analysis.recommendations && analysis.recommendations.length > 0 ? (
                        analysis.recommendations.map((rec: string, index: number) => (
                          <li key={index} className="flex">
                            <span className="mr-2 text-blue-500">→</span>
                            <span>{rec}</span>
                          </li>
                        ))
                      ) : (
                        <p className="text-gray-500 text-sm">No specific recommendations found</p>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="documents" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Document Overview</CardTitle>
                  <CardDescription>Files included in this analysis batch</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {documents.map((doc: any) => (
                      <li key={doc.id} className="py-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium">{doc.filename}</h3>
                          <Badge variant="outline">{doc.fileType.toUpperCase()}</Badge>
                        </div>
                        <p className="text-sm text-gray-500 mb-2">Uploaded on {new Date(doc.createdAt).toLocaleDateString()}</p>
                        <div className="bg-gray-50 p-3 rounded-md text-sm max-h-32 overflow-y-auto">
                          <pre className="whitespace-pre-wrap">{doc.extractedText?.substring(0, 200)}...</pre>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    );
  };
  
  // Documents List UI
  const renderDocumentsList = () => {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">My Documents</h1>
        <Card className="bg-gray-50 border-dashed">
          <CardContent className="pt-6 pb-6 flex flex-col items-center justify-center">
            <div className="rounded-full bg-primary/10 p-3 mb-3">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">Coming Soon</h3>
            <p className="text-sm text-gray-500 text-center max-w-md mb-4">
              Individual document management will be available soon. For now, please use the Document Batches feature.
            </p>
            <Button
              onClick={() => setActiveTab('batches')}
              variant="outline"
              className="mt-2"
            >
              Go to Document Batches
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  };
  
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header user={userData} />
      
      <TabNavigation 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={isAdmin}
      />
      
      <main className="flex-grow">
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {activeTab === 'documents' ? (
            renderDocumentsList()
          ) : activeTab === 'batches' ? (
            renderDocumentBatches()
          ) : activeTab === 'analysis' ? (
            renderDocumentAnalysis()
          ) : (
            <UsersList 
              onAddUser={() => setIsAddUserModalOpen(true)}
              onDeleteUser={handleDeleteUser}
              currentUserId={userData.id}
            />
          )}
        </div>
      </main>
      
      <Footer />
      
      {/* Modals */}
      <AddUserModal 
        isOpen={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
      />
      
      <DeleteConfirmModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        userId={selectedUserId}
      />
      
      {/* Create Batch Modal */}
      <Dialog open={isCreateBatchModalOpen} onOpenChange={setIsCreateBatchModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Document Batch</DialogTitle>
            <DialogDescription>
              Create a new batch to organize and analyze multiple documents together.
            </DialogDescription>
          </DialogHeader>
          
          <CreateBatchForm 
            onSuccess={() => {
              setIsCreateBatchModalOpen(false);
              toast({
                title: "Batch Created",
                description: "New document batch has been created successfully",
              });
            }}
            onCancel={() => setIsCreateBatchModalOpen(false)}
          />
        </DialogContent>
      </Dialog>
      
      {/* Upload Document Modal */}
      <Dialog open={isUploadDocumentModalOpen} onOpenChange={setIsUploadDocumentModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a document to the selected batch for analysis.
            </DialogDescription>
          </DialogHeader>
          
          <DocumentUploadForm 
            batchId={selectedBatchId}
            onSuccess={() => {
              setIsUploadDocumentModalOpen(false);
              toast({
                title: "Document Uploaded",
                description: "Document has been uploaded and processed successfully",
              });
            }}
            onCancel={() => setIsUploadDocumentModalOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Batch Modal */}
      {selectedBatchForEdit && (
        <EditBatchModal 
          isOpen={isEditBatchModalOpen}
          onClose={() => {
            setIsEditBatchModalOpen(false);
            setSelectedBatchForEdit(null);
          }}
          batch={selectedBatchForEdit}
        />
      )}
    </div>
  );
}
