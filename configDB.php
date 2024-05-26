<?php
    $databasehandler = new PDO("pgsql:host=localhost;port=5432;dbname=postgres", "postgres", "123456");
    function execution ($sql, $arguments){
        global $databasehandler;
        $query = $databasehandler->prepare($sql);
        $query->execute($arguments);
        return($query);
    }
?>