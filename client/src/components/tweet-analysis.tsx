import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Check, LucideSearch } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  username: z.string().min(1, "Username is required")
    .refine(val => !val.includes(" "), "Twitter username cannot contain spaces")
});

type FormData = z.infer<typeof formSchema>;

interface AnalysisData {
  id: number;
  username: string;
  summary: string;
  themes: string[];
  sentimentScore: number;
  sentimentLabel: string;
  sentimentConfidence: number;
  topHashtags: string[];
  keyPhrases: string[];
  createdAt: string;
}

export default function TweetAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState<string | null>(null);
  
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
    },
  });

  // Analyze tweets mutation
  const { mutate, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      // Clean @ symbol if present
      const cleanUsername = data.username.startsWith('@') 
        ? data.username.substring(1) 
        : data.username;
        
      // Make the API request
      const response = await apiRequest<AnalysisData>(`/api/analyze/${cleanUsername}`);
      return response;
    },
    onSuccess: (response: AnalysisData) => {
      setUsername(response.username);
      queryClient.invalidateQueries({ queryKey: [`/api/analyze/${response.username}`] });
      
      toast({
        title: "Analysis Complete",
        description: `Successfully analyzed tweets for @${response.username}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze tweets. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Fetch analysis if username is set
  const { data: analysis, isError, error, isLoading } = useQuery<AnalysisData>({
    queryKey: username ? [`/api/analyze/${username}`] : [],
    enabled: !!username,
  });

  const onSubmit = (data: FormData) => {
    setUsername(null); // Reset current analysis
    mutate(data);
  };

  // Helper function to get sentiment color
  const getSentimentColor = (score: number) => {
    if (score < 2) return "bg-red-100 text-red-800 border-red-200";
    if (score < 3) return "bg-orange-100 text-orange-800 border-orange-200";
    if (score < 4) return "bg-blue-100 text-blue-800 border-blue-200";
    return "bg-green-100 text-green-800 border-green-200";
  };

  // Helper function to get sentiment emoji
  const getSentimentEmoji = (score: number) => {
    if (score < 2) return "😡";
    if (score < 3) return "😐";
    if (score < 4) return "🙂";
    return "😄";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Twitter Account Analysis</CardTitle>
          <CardDescription>
            Enter a Twitter username to analyze their recent tweets using AI.
            Get insights on sentiment, themes, and key phrases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex space-x-2">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="Twitter username (e.g. elonmusk)" 
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <LucideSearch className="mr-2 h-4 w-4" />
                    Analyze
                  </>
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-lg">Analyzing tweets...</span>
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || "Failed to analyze tweets. Please try a different username or try again later."}
          </AlertDescription>
        </Alert>
      )}

      {analysis && (
        <Tabs defaultValue="summary" className="space-y-4">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
            <TabsTrigger value="themes">Themes & Keywords</TabsTrigger>
          </TabsList>
          
          <TabsContent value="summary" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tweet Summary for @{analysis.username}</CardTitle>
                <CardDescription>A summary of recent tweets from this account</CardDescription>
              </CardHeader>
              <CardContent>
                <p>{analysis.summary}</p>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="sentiment" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Sentiment Analysis</CardTitle>
                <CardDescription>The emotional tone of the tweets</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center mb-4">
                  <div className="text-6xl mr-4">
                    {getSentimentEmoji(analysis.sentimentScore)}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold capitalize">{analysis.sentimentLabel}</h3>
                    <p className="text-sm text-gray-600">
                      Score: {analysis.sentimentScore}/5 (Confidence: {Math.round(analysis.sentimentConfidence * 100)}%)
                    </p>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-primary h-2.5 rounded-full" 
                    style={{ width: `${(analysis.sentimentScore / 5) * 100}%` }}
                  ></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="themes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Themes & Key Phrases</CardTitle>
                <CardDescription>Main topics and important phrases from the tweets</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-2">Major Themes</h3>
                  <div className="flex flex-wrap gap-2">
                    {analysis.themes.map((theme, index) => (
                      <Badge key={index} variant="outline" className="px-3 py-1">
                        {theme}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-2">Key Phrases</h3>
                  <div className="flex flex-wrap gap-2">
                    {analysis.keyPhrases.map((phrase, index) => (
                      <Badge key={index} variant="secondary" className="px-3 py-1">
                        {phrase}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                {analysis.topHashtags.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Hashtags</h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.topHashtags.map((hashtag, index) => (
                        <Badge key={index} className="px-3 py-1">
                          #{hashtag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="text-xs text-gray-500">
                Analysis performed {new Date(analysis.createdAt).toLocaleDateString()} at {new Date(analysis.createdAt).toLocaleTimeString()}
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}